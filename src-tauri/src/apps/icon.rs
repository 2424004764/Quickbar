//! 应用图标提取与磁盘缓存（Windows：从 .lnk/.exe 取壳图标）
//! .lnk 会先解析目标再抽图标，避免快捷方式箭头角标

use crate::config::data_dir;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 图标缓存目录 ~/.quickbar/icon_cache
pub fn icon_cache_dir() -> PathBuf {
    data_dir().join("icon_cache")
}

fn cache_key(path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    // 版本位：换算法后旧缓存（含快捷方式箭头）自动失效
    "icon-v2-no-lnk-overlay".hash(&mut hasher);
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn cache_png_path(app_path: &str) -> PathBuf {
    icon_cache_dir().join(format!("{}.png", cache_key(app_path)))
}

/// 确保缓存中有 PNG，返回 data URL（data:image/png;base64,...）
/// 对 `ms-settings:` 等特殊 URI 会回落到系统设置 exe 取图标
pub fn ensure_icon_data_url(app_path: &str) -> Option<String> {
    let path = app_path.trim().to_string();
    if path.is_empty() {
        return None;
    }
    // 图标链路可能经过损坏 .lnk / 壳 API；panic 不能冒泡到 WebView 回调
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ensure_icon_data_url_inner(&path)
    })) {
        Ok(v) => v,
        Err(_) => {
            eprintln!("quickbar: icon extract panicked for {path}");
            None
        }
    }
}

fn ensure_icon_data_url_inner(app_path: &str) -> Option<String> {
    if app_path.starts_with("ms-settings:") {
        return windows_settings_icon_data_url();
    }
    ensure_icon_from_file(app_path)
}

fn ensure_icon_from_file(app_path: &str) -> Option<String> {
    let png_path = cache_png_path(app_path);
    if !png_path.exists() {
        let extract_from = icon_extract_path(app_path);
        let bytes = extract_icon_png(&extract_from)?;
        let _ = fs::create_dir_all(icon_cache_dir());
        if fs::write(&png_path, &bytes).is_err() {
            return encode_data_url(&bytes);
        }
    }
    let bytes = fs::read(&png_path).ok()?;
    encode_data_url(&bytes)
}

/// 抽图标用的真实路径：.lnk → 目标 exe/文件（无角标）
fn icon_extract_path(app_path: &str) -> String {
    let path = Path::new(app_path);
    let is_lnk = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("lnk"))
        .unwrap_or(false);
    if is_lnk {
        if let Some(target) = resolve_lnk_target(path) {
            if target.is_file() {
                return target.to_string_lossy().into_owned();
            }
        }
    }
    app_path.to_string()
}

/// 解析 .lnk 目标。部分损坏/特殊快捷方式会让 lnk crate 内部 unwrap panic，必须吞掉以免拖垮进程。
#[cfg(windows)]
fn resolve_lnk_target(path: &Path) -> Option<PathBuf> {
    let owned = path.to_path_buf();
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        resolve_lnk_target_fallible(&owned)
    })) {
        Ok(v) => v,
        Err(_) => {
            eprintln!(
                "quickbar: skip malformed .lnk (lnk crate panic): {}",
                path.display()
            );
            None
        }
    }
}

#[cfg(windows)]
fn resolve_lnk_target_fallible(path: &Path) -> Option<PathBuf> {
    use lnk::ShellLink;

    let link = ShellLink::open(path).ok()?;
    if let Some(info) = link.link_info() {
        let base = info
            .local_base_path_unicode()
            .as_ref()
            .or_else(|| info.local_base_path().as_ref());
        if let Some(base) = base {
            let p = PathBuf::from(base);
            if !p.as_os_str().is_empty() {
                return Some(p);
            }
        }
    }
    // 部分快捷方式只有相对路径
    if let Some(rel) = link.relative_path() {
        if let Some(parent) = path.parent() {
            let p = parent.join(rel);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn resolve_lnk_target(_path: &Path) -> Option<PathBuf> {
    None
}

fn encode_data_url(png: &[u8]) -> Option<String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(png);
    Some(format!("data:image/png;base64,{b64}"))
}

/// Windows「设置」应用图标（SystemSettings.exe）
pub fn windows_settings_icon_data_url() -> Option<String> {
    static CACHED: OnceLock<Option<String>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            for exe in windows_settings_exe_candidates() {
                if exe.is_file() {
                    if let Some(url) = ensure_icon_from_file(&exe.to_string_lossy()) {
                        return Some(url);
                    }
                }
            }
            None
        })
        .clone()
}

/// Quickbar「设置」用的齿轮图标（SVG，仿 Windows 设置蓝底齿轮）
pub fn host_settings_icon_data_url() -> String {
    const SVG: &str = concat!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">"##,
        r##"<rect width="48" height="48" rx="12" fill="#0078D4"/>"##,
        r##"<path fill="#fff" d="M26.9 12.2l.6 2.6a9.8 9.8 0 0 1 2.4 1.4l2.5-.9 2.1 2.1-.9 2.5c.5.7 1 1.5 1.4 2.4l2.6.6v3l-2.6.6c-.4.9-.9 1.7-1.4 2.4l.9 2.5-2.1 2.1-2.5-.9a9.8 9.8 0 0 1-2.4 1.4l-.6 2.6h-3l-.6-2.6a9.8 9.8 0 0 1-2.4-1.4l-2.5.9-2.1-2.1.9-2.5a9.8 9.8 0 0 1-1.4-2.4L12.2 27v-3l2.6-.6c.4-.9.9-1.7 1.4-2.4l-.9-2.5 2.1-2.1 2.5.9c.7-.5 1.5-1 2.4-1.4l.6-2.6h3zM24 19.5A4.5 4.5 0 1 0 24 28.5 4.5 4.5 0 0 0 24 19.5z"/>"##,
        r##"</svg>"##,
    );
    svg_data_url(SVG)
}

/// 应用市场图标
pub fn host_market_icon_data_url() -> String {
    const SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#7C3AED"/><path fill="#fff" d="M16 18h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V20a2 2 0 0 1 2-2zm2 4v8h12v-8H18zm3-7a3 3 0 0 1 6 0v2h-2v-2a1 1 0 0 0-2 0v2h-2v-2z"/></svg>"##;
    svg_data_url(SVG)
}

/// LINUX DO 社区
pub fn host_linux_do_icon_data_url() -> String {
    const SVG: &str = concat!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">"##,
        r##"<rect width="48" height="48" rx="12" fill="#FF6A00"/>"##,
        r##"<text x="24" y="30" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff">LDO</text>"##,
        r##"</svg>"##,
    );
    svg_data_url(SVG)
}

/// V2EX
pub fn host_v2ex_icon_data_url() -> String {
    const SVG: &str = concat!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">"##,
        r##"<rect width="48" height="48" rx="12" fill="#1A1A1A"/>"##,
        r##"<text x="24" y="30" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="700" fill="#fff">V2</text>"##,
        r##"</svg>"##,
    );
    svg_data_url(SVG)
}

fn svg_data_url(svg: &str) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(svg.as_bytes());
    format!("data:image/svg+xml;base64,{b64}")
}

fn windows_settings_exe_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(root) = std::env::var("SystemRoot").or_else(|_| std::env::var("WINDIR")) {
        let root = PathBuf::from(root);
        out.push(root.join(r"ImmersiveControlPanel\SystemSettings.exe"));
        out.push(root.join(r"System32\SystemSettingsAdminFlows.exe"));
        out.push(root.join(r"System32\SystemSettingsBroker.exe"));
    }
    out.push(PathBuf::from(
        r"C:\Windows\ImmersiveControlPanel\SystemSettings.exe",
    ));
    out
}

#[cfg(windows)]
fn extract_icon_png(app_path: &str) -> Option<Vec<u8>> {
    use base64::Engine;

    let b64 = windows_icons::get_icon_base64_by_path(app_path).ok()?;
    let raw = b64
        .strip_prefix("data:image/png;base64,")
        .or_else(|| b64.strip_prefix("data:image/x-icon;base64,"))
        .unwrap_or(b64.as_str())
        .trim();
    base64::engine::general_purpose::STANDARD.decode(raw).ok()
}

#[cfg(not(windows))]
fn extract_icon_png(_app_path: &str) -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 缓存键对相同路径稳定() {
        let a = cache_key(r"C:\Apps\Postman\Postman.lnk");
        let b = cache_key(r"C:\Apps\Postman\Postman.lnk");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn 缓存文件名带png后缀() {
        let p = cache_png_path("demo");
        assert_eq!(p.extension().and_then(|e| e.to_str()), Some("png"));
    }

    #[test]
    fn 内置齿轮图标为svg_data_url() {
        let u = host_settings_icon_data_url();
        assert!(u.starts_with("data:image/svg+xml;base64,"));
    }

    #[test]
    fn 非lnk路径原样抽取() {
        assert_eq!(
            icon_extract_path(r"C:\Windows\System32\notepad.exe"),
            r"C:\Windows\System32\notepad.exe"
        );
    }
}
