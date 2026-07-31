//! 磁盘 / 文件夹占用分析：统计目录总大小与一级子项占比。
//!
//! 扫描在后台线程池里跑（命令是 async + spawn_blocking），否则会阻塞 WebView 主线程；
//! 大盘扫描期间通过事件上报进度（含已完成条目、按大小降序），并支持随时取消。

use once_cell::sync::Lazy;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

/// 进度事件名（前端监听）
pub const PROGRESS_EVENT: &str = "quickbar://disk-usage-progress";
/// 扫描结束事件名：分离窗口后由新窗口接收最终结果
pub const DONE_EVENT: &str = "quickbar://disk-usage-done";

static CANCEL: AtomicBool = AtomicBool::new(false);

/// 全局扫描状态：窗口切换 / 分离后新窗口可以接管同一次扫描
#[derive(Default)]
struct ScanShared {
    running: bool,
    root: String,
    progress: Option<DiskProgress>,
    result: Option<DiskBreakdown>,
}

static SCAN: Lazy<Mutex<ScanShared>> = Lazy::new(|| Mutex::new(ScanShared::default()));

fn scan_lock() -> std::sync::MutexGuard<'static, ScanShared> {
    SCAN.lock().unwrap_or_else(|e| e.into_inner())
}

/// 当前扫描状态：新开的窗口据此恢复进度或直接展示上次结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskScanState {
    pub running: bool,
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<DiskProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<DiskBreakdown>,
}

/// 供其它窗口挂载时同步当前扫描
#[tauri::command]
pub fn disk_scan_state() -> DiskScanState {
    let scan = scan_lock();
    DiskScanState {
        running: scan.running,
        root: scan.root.clone(),
        progress: scan.progress.clone(),
        result: scan.result.clone(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskDrive {
    pub path: String,
    pub label: String,
    /// 卷总容量（字节）；取不到则为 null
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<u64>,
}

/// 所在卷的容量信息（总 / 已用 / 剩余）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskVolume {
    /// 查询用的卷根路径，如 `C:\`
    pub path: String,
    pub total: u64,
    pub free: u64,
    pub used: u64,
    /// 已用百分比 0–100
    pub used_percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// 占总大小百分比（0–100）；扫描中相对已完成合计
    pub percent: f64,
    /// 是否已完成扫描
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskBreakdown {
    pub root: String,
    pub total_size: u64,
    pub entry_count: usize,
    pub scanned_files: u64,
    pub entries: Vec<DiskEntry>,
    pub elapsed_ms: u64,
    pub canceled: bool,
    /// 所在磁盘卷容量（总/已用/剩余）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<DiskVolume>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskProgress {
    root: String,
    scanned_files: u64,
    scanned_bytes: u64,
    done_entries: usize,
    total_entries: usize,
    current: String,
    elapsed_ms: u64,
    /// 已完成的条目，按 size 降序；末尾附带未完成项（size=0）
    entries: Vec<DiskEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    volume: Option<DiskVolume>,
}

#[tauri::command]
pub fn disk_list_drives() -> Result<Vec<DiskDrive>, String> {
    let mut drives = Vec::new();
    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if Path::new(&path).exists() {
                let vol = query_volume(&path);
                drives.push(DiskDrive {
                    path: path.clone(),
                    label: format!("{}:", letter as char),
                    total: vol.as_ref().map(|v| v.total),
                    free: vol.as_ref().map(|v| v.free),
                    used: vol.as_ref().map(|v| v.used),
                });
            }
        }
    }
    #[cfg(not(windows))]
    {
        if Path::new("/").exists() {
            let vol = query_volume("/");
            drives.push(DiskDrive {
                path: "/".into(),
                label: "/".into(),
                total: vol.as_ref().map(|v| v.total),
                free: vol.as_ref().map(|v| v.free),
                used: vol.as_ref().map(|v| v.used),
            });
        }
        for candidate in ["/Volumes", "/media", "/mnt"] {
            if let Ok(rd) = fs::read_dir(Path::new(candidate)) {
                for ent in rd.flatten() {
                    let p = ent.path();
                    if p.is_dir() {
                        let path = p.to_string_lossy().to_string();
                        let vol = query_volume(&path);
                        drives.push(DiskDrive {
                            path: path.clone(),
                            label: ent.file_name().to_string_lossy().to_string(),
                            total: vol.as_ref().map(|v| v.total),
                            free: vol.as_ref().map(|v| v.free),
                            used: vol.as_ref().map(|v| v.used),
                        });
                    }
                }
            }
        }
    }
    Ok(drives)
}

/// 查询路径所在卷的总容量 / 可用 / 已用
fn query_volume(path: &str) -> Option<DiskVolume> {
    let root = volume_root(path);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        let wide: Vec<u16> = std::ffi::OsStr::new(&root)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut free_to_caller: u64 = 0;
        let mut total: u64 = 0;
        let mut free: u64 = 0;
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_to_caller,
                &mut total,
                &mut free,
            )
        };
        if ok == 0 || total == 0 {
            return None;
        }
        let used = total.saturating_sub(free);
        let used_percent = (used as f64 / total as f64) * 100.0;
        Some(DiskVolume {
            path: root,
            total,
            free,
            used,
            used_percent,
        })
    }
    #[cfg(not(windows))]
    {
        // 非 Windows：暂用目录扫描无法拿到卷容量；返回 None
        // （后续可接 libc::statvfs）
        let _ = root;
        None
    }
}

/// 取路径所在卷根：Windows `C:\Users` → `C:\`；其它原样
fn volume_root(path: &str) -> String {
    let p = path.trim();
    #[cfg(windows)]
    {
        let bytes = p.as_bytes();
        if bytes.len() >= 2 && bytes[1] == b':' {
            let letter = (bytes[0] as char).to_ascii_uppercase();
            if letter.is_ascii_alphabetic() {
                return format!("{}:\\", letter);
            }
        }
        // UNC：\\server\share\... → \\server\share\
        if p.starts_with("\\\\") {
            let rest = &p[2..];
            let parts: Vec<&str> = rest.split(['\\', '/']).filter(|s| !s.is_empty()).collect();
            if parts.len() >= 2 {
                return format!("\\\\{}\\{}\\", parts[0], parts[1]);
            }
        }
    }
    if p.is_empty() {
        ".".into()
    } else {
        p.to_string()
    }
}

/// 请求取消当前扫描（下一次检查点生效）
#[tauri::command]
pub fn disk_cancel_analyze() {
    CANCEL.store(true, Ordering::Relaxed);
}

/// 统计路径占用：返回总大小 + 一级子项（按大小降序）。
#[tauri::command]
pub async fn disk_analyze(app: AppHandle, path: String) -> Result<DiskBreakdown, String> {
    CANCEL.store(false, Ordering::Relaxed);
    {
        let mut scan = scan_lock();
        scan.running = true;
        scan.root = path.trim().to_string();
        scan.progress = None;
        scan.result = None;
    }
    let emit_app = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || analyze_blocking(&app, &path))
        .await
        .map_err(|e| format!("扫描任务失败: {e}"))?;

    {
        let mut scan = scan_lock();
        scan.running = false;
        scan.progress = None;
        scan.result = out.as_ref().ok().cloned();
    }
    // 结束事件让「分离出去的新窗口」也能拿到最终结果
    if let Ok(breakdown) = out.as_ref() {
        let _ = emit_app.emit(DONE_EVENT, breakdown.clone());
    }
    out
}

struct ChildMeta {
    name: String,
    path: PathBuf,
    is_dir: bool,
}

/// 扫描期间共享的计数与节流上报
struct Progress<'a> {
    app: &'a AppHandle,
    root: String,
    started: Instant,
    scanned_files: AtomicU64,
    scanned_bytes: AtomicU64,
    done_entries: AtomicUsize,
    total_entries: usize,
    last_emit_ms: AtomicU64,
    children: &'a [ChildMeta],
    /// None = 未完成；Some(size) = 已完成
    sizes: &'a [AtomicU64],
    /// 与 sizes 平行：1 = 已完成
    done_flags: &'a [AtomicBool],
    /// 串行化发射，避免乱序覆盖
    emit_lock: Mutex<()>,
    volume: Option<DiskVolume>,
}

impl Progress<'_> {
    fn snapshot_entries(&self) -> Vec<DiskEntry> {
        let mut done: Vec<DiskEntry> = Vec::new();
        let mut pending: Vec<DiskEntry> = Vec::new();
        for (i, child) in self.children.iter().enumerate() {
            let finished = self.done_flags[i].load(Ordering::Relaxed);
            let size = if finished {
                self.sizes[i].load(Ordering::Relaxed)
            } else {
                0
            };
            let entry = DiskEntry {
                name: child.name.clone(),
                path: child.path.to_string_lossy().to_string(),
                is_dir: child.is_dir,
                size,
                percent: 0.0,
                done: finished,
            };
            if finished {
                done.push(entry);
            } else {
                pending.push(entry);
            }
        }
        done.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
        pending.sort_by(|a, b| a.name.cmp(&b.name));
        let total: u64 = done.iter().map(|e| e.size).sum();
        for e in &mut done {
            e.percent = if total == 0 {
                0.0
            } else {
                (e.size as f64 / total as f64) * 100.0
            };
        }
        done.extend(pending);
        done
    }

    fn maybe_emit(&self, current: &str, force: bool) {
        let now_ms = self.started.elapsed().as_millis() as u64;
        let last = self.last_emit_ms.load(Ordering::Relaxed);
        if !force && now_ms.saturating_sub(last) < 200 {
            return;
        }
        let _guard = self.emit_lock.lock().unwrap_or_else(|e| e.into_inner());
        let last = self.last_emit_ms.load(Ordering::Relaxed);
        if !force && now_ms.saturating_sub(last) < 200 {
            return;
        }
        self.last_emit_ms.store(now_ms, Ordering::Relaxed);
        let payload = DiskProgress {
            root: self.root.clone(),
            scanned_files: self.scanned_files.load(Ordering::Relaxed),
            scanned_bytes: self.scanned_bytes.load(Ordering::Relaxed),
            done_entries: self.done_entries.load(Ordering::Relaxed),
            total_entries: self.total_entries,
            current: current.to_string(),
            elapsed_ms: now_ms,
            entries: self.snapshot_entries(),
            volume: self.volume.clone(),
        };
        // 存一份快照，新窗口挂载时可立即恢复进度
        scan_lock().progress = Some(payload.clone());
        let _ = self.app.emit(PROGRESS_EVENT, payload);
    }
}

fn analyze_blocking(app: &AppHandle, path: &str) -> Result<DiskBreakdown, String> {
    let root = PathBuf::from(path.trim());
    if !root.exists() {
        return Err(format!("路径不存在: {}", root.display()));
    }
    let meta = fs::metadata(&root).map_err(|e| format!("无法读取: {e}"))?;
    let started = Instant::now();
    let volume = query_volume(&root.to_string_lossy());

    if meta.is_file() {
        let size = meta.len();
        let name = root
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string());
        return Ok(DiskBreakdown {
            root: root.to_string_lossy().to_string(),
            total_size: size,
            entry_count: 1,
            scanned_files: 1,
            entries: vec![DiskEntry {
                name,
                path: root.to_string_lossy().to_string(),
                is_dir: false,
                size,
                percent: 100.0,
                done: true,
            }],
            elapsed_ms: started.elapsed().as_millis() as u64,
            canceled: false,
            volume,
        });
    }

    let mut children: Vec<ChildMeta> = Vec::new();
    let rd = fs::read_dir(&root).map_err(|e| format!("无法读取目录: {e}"))?;
    for ent in rd.flatten() {
        let Ok(file_type) = ent.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if !file_type.is_dir() && !file_type.is_file() {
            continue;
        }
        children.push(ChildMeta {
            name: ent.file_name().to_string_lossy().to_string(),
            path: ent.path(),
            is_dir: file_type.is_dir(),
        });
    }

    let sizes: Vec<AtomicU64> = children.iter().map(|_| AtomicU64::new(0)).collect();
    let done_flags: Vec<AtomicBool> = children.iter().map(|_| AtomicBool::new(false)).collect();

    let progress = Progress {
        app,
        root: root.to_string_lossy().to_string(),
        started,
        scanned_files: AtomicU64::new(0),
        scanned_bytes: AtomicU64::new(0),
        done_entries: AtomicUsize::new(0),
        total_entries: children.len(),
        last_emit_ms: AtomicU64::new(0),
        children: &children,
        sizes: &sizes,
        done_flags: &done_flags,
        emit_lock: Mutex::new(()),
        volume: volume.clone(),
    };
    // 先把未完成列表推给前端，立刻有内容可看
    progress.maybe_emit("", true);

    let next = AtomicUsize::new(0);
    let worker_count = worker_count(children.len());

    std::thread::scope(|scope| {
        for _ in 0..worker_count {
            scope.spawn(|| loop {
                if CANCEL.load(Ordering::Relaxed) {
                    return;
                }
                let idx = next.fetch_add(1, Ordering::Relaxed);
                let Some(child) = children.get(idx) else {
                    return;
                };
                let size = if child.is_dir {
                    dir_size(&child.path, &progress)
                } else {
                    let s = fs::metadata(&child.path).map(|m| m.len()).unwrap_or(0);
                    progress.scanned_files.fetch_add(1, Ordering::Relaxed);
                    progress.scanned_bytes.fetch_add(s, Ordering::Relaxed);
                    s
                };
                sizes[idx].store(size, Ordering::Relaxed);
                done_flags[idx].store(true, Ordering::Relaxed);
                progress.done_entries.fetch_add(1, Ordering::Relaxed);
                // 每完成一项强制推一次，保证列表动态重排
                progress.maybe_emit(&child.name, true);
            });
        }
    });

    let canceled = CANCEL.load(Ordering::Relaxed);
    let mut entries = progress.snapshot_entries();
    // 最终结果只保留已完成项（取消时未扫完的不计入）
    if canceled {
        entries.retain(|e| e.done);
    } else {
        for e in &mut entries {
            e.done = true;
        }
    }
    let total_size: u64 = entries.iter().map(|e| e.size).sum();
    for e in &mut entries {
        e.percent = if total_size == 0 {
            0.0
        } else {
            (e.size as f64 / total_size as f64) * 100.0
        };
    }

    progress.maybe_emit("", true);

    Ok(DiskBreakdown {
        root: root.to_string_lossy().to_string(),
        total_size,
        entry_count: entries.len(),
        scanned_files: progress.scanned_files.load(Ordering::Relaxed),
        entries,
        elapsed_ms: started.elapsed().as_millis() as u64,
        canceled,
        volume,
    })
}

fn worker_count(entry_count: usize) -> usize {
    if entry_count == 0 {
        return 1;
    }
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    cpus.clamp(2, 8).min(entry_count)
}

fn dir_size(path: &Path, progress: &Progress<'_>) -> u64 {
    let mut total: u64 = 0;
    let mut since_check: u32 = 0;
    let walker = WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok());
    for entry in walker {
        since_check += 1;
        if since_check >= 512 {
            since_check = 0;
            if CANCEL.load(Ordering::Relaxed) {
                break;
            }
            // 大目录扫到一半也刷一下进度数字（列表排序不变，但文件数/字节数会动）
            progress.maybe_emit(
                &path
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                false,
            );
        }
        if !entry.file_type().is_file() {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            total = total.saturating_add(meta.len());
            progress.scanned_files.fetch_add(1, Ordering::Relaxed);
            progress
                .scanned_bytes
                .fetch_add(meta.len(), Ordering::Relaxed);
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn volume_root_windows_drive() {
        assert_eq!(volume_root("C:\\Users\\foo"), "C:\\");
        assert_eq!(volume_root("d:/temp"), "D:\\");
        assert_eq!(volume_root("E:"), "E:\\");
    }

    #[test]
    fn worker_count_is_bounded() {
        assert_eq!(worker_count(0), 1);
        assert_eq!(worker_count(1), 1);
        assert!(worker_count(100) >= 2 && worker_count(100) <= 8);
    }

    #[test]
    fn dir_size_sums_nested_files() {
        let dir = std::env::temp_dir().join(format!(
            "qb_disk_usage_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join("sub")).unwrap();
        {
            let mut f = fs::File::create(dir.join("a.txt")).unwrap();
            f.write_all(b"hello world!!").unwrap();
        }
        {
            let mut f = fs::File::create(dir.join("sub").join("b.txt")).unwrap();
            f.write_all(b"xyz").unwrap();
        }

        let total = raw_dir_size(&dir);
        assert_eq!(total, 16);
        let _ = fs::remove_dir_all(&dir);
    }

    fn raw_dir_size(path: &Path) -> u64 {
        WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum()
    }
}
