//! PostgreSQL 连接配置与 pg_dump / psql 迁移

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

use crate::config::data_dir;

/// 迁移过程逐步日志（前端实时展示）
pub const LOG_EVENT: &str = "quickbar://pg-migrate-log";
/// 单步审核：等待前端确认后继续
pub const AWAIT_EVENT: &str = "quickbar://pg-migrate-await";
/// 审核结束 / 取消时清空前端等待态
pub const AWAIT_CLEAR_EVENT: &str = "quickbar://pg-migrate-await-clear";

static REVIEW_REPLIES: Lazy<Mutex<HashMap<String, mpsc::Sender<bool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateAwaitPayload {
    pub session_id: String,
    /// plan | dump | remap | soften | ensure_schema | restore
    pub step: String,
    /// 当前第几步（从 1 起）
    pub step_index: u32,
    /// 预计总步数
    pub step_total: u32,
    /// 短标题（人话）
    pub title: String,
    /// 主要说明：要干什么、现在会不会改库
    pub summary: String,
    /// 补充核对信息（连接、路径等）
    pub detail: String,
    /// 风险 / 注意事项（人话）
    pub risks: Vec<String>,
    /// 确认按钮旁的提示，如「点确认后才会开始导出」
    pub action_hint: String,
    pub can_skip: bool,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateLogLine {
    pub step: String,
    /// info | ok | warn | error
    pub level: String,
    pub message: String,
    pub elapsed_ms: u64,
}

struct MigrateLogger {
    app: AppHandle,
    started: Instant,
    lines: Vec<String>,
    log_path: PathBuf,
}

impl MigrateLogger {
    fn new(app: AppHandle, log_path: PathBuf) -> Self {
        if let Some(parent) = log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&log_path, "");
        Self {
            app,
            started: Instant::now(),
            lines: Vec::new(),
            log_path,
        }
    }

    fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    fn log(&mut self, step: &str, level: &str, message: &str) {
        let elapsed_ms = self.elapsed_ms();
        let line = format!("[{elapsed_ms:>7}ms] [{level:<5}] [{step}] {message}");
        self.lines.push(line.clone());
        let _ = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .and_then(|mut f| writeln!(f, "{line}"));
        let _ = self.app.emit(
            LOG_EVENT,
            MigrateLogLine {
                step: step.to_string(),
                level: level.to_string(),
                message: message.to_string(),
                elapsed_ms,
            },
        );
    }

    fn info(&mut self, step: &str, message: impl AsRef<str>) {
        self.log(step, "info", message.as_ref());
    }

    fn ok(&mut self, step: &str, message: impl AsRef<str>) {
        self.log(step, "ok", message.as_ref());
    }

    fn warn(&mut self, step: &str, message: impl AsRef<str>) {
        self.log(step, "warn", message.as_ref());
    }

    fn error(&mut self, step: &str, message: impl AsRef<str>) {
        self.log(step, "error", message.as_ref());
    }

    fn text(&self) -> String {
        self.lines.join("\n")
    }

    fn path_str(&self) -> String {
        self.log_path.to_string_lossy().to_string()
    }
}

fn trim_output(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.is_empty() {
        return String::new();
    }
    if t.chars().count() <= max {
        return t.to_string();
    }
    let truncated: String = t.chars().take(max).collect();
    format!("{truncated}… (共 {} 字符)", t.chars().count())
}

fn conn_summary(conn: &PgConnection) -> String {
    let name = if conn.name.trim().is_empty() {
        "(未命名)"
    } else {
        conn.name.trim()
    };
    format!(
        "{name} — {user}@{host}:{port}/{database}",
        user = conn.user,
        host = conn.host,
        port = conn.port,
        database = conn.database,
    )
}

fn tool_label(tool: &PgTool) -> String {
    match tool {
        PgTool::Native(p) => p.clone(),
        PgTool::Wsl { tool } => format!("wsl:{tool}"),
    }
}

fn format_args(args: &[String]) -> String {
    args.iter()
        .map(|a| {
            if a.starts_with("PGPASSWORD=") {
                "PGPASSWORD=***".to_string()
            } else if a.contains(' ') {
                format!("\"{a}\"")
            } else {
                a.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_bytes(n: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let n = n as f64;
    if n >= GB {
        format!("{:.2} GB", n / GB)
    } else if n >= MB {
        format!("{:.2} MB", n / MB)
    } else if n >= KB {
        format!("{:.1} KB", n / KB)
    } else {
        format!("{n:.0} B")
    }
}

/// 前端确认 / 取消当前审核步骤
#[tauri::command]
pub fn pg_migrate_review_reply(session_id: String, approved: bool) -> Result<(), String> {
    let tx = REVIEW_REPLIES
        .lock()
        .remove(session_id.trim())
        .ok_or_else(|| "没有等待中的审核步骤（可能已超时或已结束）".to_string())?;
    let _ = tx.send(approved);
    Ok(())
}

fn clear_review_wait(app: &AppHandle, session_id: &str) {
    REVIEW_REPLIES.lock().remove(session_id);
    let _ = app.emit(AWAIT_CLEAR_EVENT, session_id.to_string());
}

fn await_review(
    app: &AppHandle,
    logger: &mut MigrateLogger,
    session_id: &str,
    enabled: bool,
    step: &str,
    step_index: u32,
    step_total: u32,
    title: &str,
    summary: &str,
    detail: &str,
    risks: Vec<String>,
    action_hint: &str,
) -> Result<(), String> {
    if !enabled {
        return Ok(());
    }
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err("单步审核需要 sessionId".into());
    }

    // 丢弃上一轮未消费的回复通道
    REVIEW_REPLIES.lock().remove(session_id);

    let (tx, rx) = mpsc::channel::<bool>();
    REVIEW_REPLIES.lock().insert(session_id.to_string(), tx);

    logger.info("审核", format!("等待确认：{title}"));
    let _ = app.emit(
        AWAIT_EVENT,
        MigrateAwaitPayload {
            session_id: session_id.to_string(),
            step: step.to_string(),
            step_index,
            step_total,
            title: title.to_string(),
            summary: summary.to_string(),
            detail: detail.to_string(),
            risks,
            action_hint: action_hint.to_string(),
            can_skip: false,
            elapsed_ms: logger.elapsed_ms(),
        },
    );

    let approved = match rx.recv_timeout(Duration::from_secs(60 * 60)) {
        Ok(v) => v,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            clear_review_wait(app, session_id);
            logger.error("审核", "等待确认超时（1 小时）");
            return Err("单步审核超时：未在 1 小时内确认".into());
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            clear_review_wait(app, session_id);
            logger.error("审核", "审核通道已断开");
            return Err("单步审核已中断".into());
        }
    };

    let _ = app.emit(AWAIT_CLEAR_EVENT, session_id.to_string());
    if approved {
        logger.ok("审核", format!("已确认：{title}"));
        Ok(())
    } else {
        logger.warn("审核", format!("用户取消：{title}"));
        Err(format!("用户取消迁移（停在：{title}）"))
    }
}

fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
    let h = haystack.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || h.len() < n.len() {
        return None;
    }
    for i in 0..=(h.len() - n.len()) {
        if h[i..i + n.len()].eq_ignore_ascii_case(n) {
            return Some(i);
        }
    }
    None
}

/// 将 dump 中的 `CREATE SCHEMA` 改成 `IF NOT EXISTS`，避免目标已有 schema 时失败
fn soften_create_schema_statements(sql: &str) -> (String, usize) {
    let mut count = 0usize;
    let mut out = String::with_capacity(sql.len() + 64);
    for line in sql.split_inclusive('\n') {
        let trimmed_start = line.trim_start_matches([' ', '\t']);
        let prefix_len = line.len() - trimmed_start.len();
        if find_ci(trimmed_start, "CREATE SCHEMA IF NOT EXISTS").is_some() {
            out.push_str(line);
            continue;
        }
        if let Some(pos) = find_ci(trimmed_start, "CREATE SCHEMA") {
            let mut rebuilt = String::with_capacity(line.len() + 16);
            rebuilt.push_str(&line[..prefix_len]);
            rebuilt.push_str(&trimmed_start[..pos]);
            rebuilt.push_str("CREATE SCHEMA IF NOT EXISTS");
            rebuilt.push_str(&trimmed_start[pos + "CREATE SCHEMA".len()..]);
            out.push_str(&rebuilt);
            count += 1;
        } else {
            out.push_str(line);
        }
    }
    (out, count)
}

/// 处理 dump 中的整库 `DROP SCHEMA`。
///
/// `--clean` 会生成不带 CASCADE 的 `DROP SCHEMA x;`，目标里只要还有依赖对象就会失败。
/// 默认注释掉该语句（同名对象仍由各自的 DROP 处理）；`cascade` 为真时改成 CASCADE 整体重建。
fn adjust_drop_schema_statements(sql: &str, schema: &str, cascade: bool) -> (String, usize) {
    let mut count = 0usize;
    let mut out = String::with_capacity(sql.len() + 128);
    for line in sql.split_inclusive('\n') {
        let body = line.trim_end_matches(['\r', '\n']);
        let trimmed = body.trim_start_matches([' ', '\t']);
        if trimmed.starts_with("--") || find_ci(trimmed, "DROP SCHEMA").is_none() {
            out.push_str(line);
            continue;
        }
        let newline = &line[body.len()..];
        if cascade {
            out.push_str(&format!(
                "DROP SCHEMA IF EXISTS \"{schema}\" CASCADE;{newline}"
            ));
        } else {
            out.push_str(&format!("-- [quickbar] 已跳过整库删除: {body}{newline}"));
        }
        count += 1;
    }
    (out, count)
}

fn target_schema_exists(
    store: &PgMigrateStore,
    conn: &PgConnection,
    schema: &str,
) -> Result<bool, String> {
    let psql = resolve_tool(&store.bin_dir, "psql");
    let mut args = base_args(conn);
    // schema 已通过 validate_schema_name，仅含安全字符
    let sql = format!(
        "SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = '{schema}' LIMIT 1;"
    );
    args.extend(["-t".into(), "-A".into(), "-c".into(), sql]);
    let result = run_pg_tool(&psql, &args, &pg_env(conn))?;
    if result.code != 0 {
        return Err(format!(
            "检查目标 schema 是否存在失败:\n{}",
            result.stderr.trim()
        ));
    }
    Ok(result.stdout.lines().any(|l| l.trim() == "1"))
}

fn dump_sql_preview(path: &str, max_chars: usize) -> String {
    match fs::read_to_string(path) {
        Ok(sql) => {
            let preview: String = sql.chars().take(max_chars).collect();
            if sql.chars().count() > max_chars {
                format!("{preview}\n… (已截断，完整见文件)")
            } else {
                preview
            }
        }
        Err(e) => format!("(无法读取 SQL: {e})"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PgConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PgMigrateStore {
    #[serde(default)]
    pub connections: Vec<PgConnection>,
    /// pg_dump / psql 可执行文件所在目录（可空，走 PATH）
    #[serde(default)]
    pub bin_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

fn store_path_plain() -> PathBuf {
    data_dir().join("pg-migrate.json")
}

fn store_path_vault() -> PathBuf {
    data_dir().join("pg-migrate.vault.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultFile {
    v: u32,
    alg: String,
    #[serde(default)]
    nonce: String,
    data: String,
}

/// Windows：DPAPI（绑定当前登录用户，拷走文件无法在其他机器/用户解密）
#[cfg(windows)]
fn protect_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPT_INTEGER_BLOB,
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &mut input,
            windows_sys::core::w!("Quickbar PG connections"),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("DPAPI 加密失败".into());
    }
    if output.pbData.is_null() || output.cbData == 0 {
        return Err("DPAPI 加密返回空数据".into());
    }
    let out = unsafe {
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let v = slice.to_vec();
        LocalFree(output.pbData as _);
        v
    };
    Ok(out)
}

#[cfg(windows)]
fn unprotect_bytes(cipher: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    let mut owned = cipher.to_vec();
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: owned.len() as u32,
        pbData: owned.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(
            "DPAPI 解密失败（须由本机保存该配置的 Windows 用户打开 Quickbar）".into(),
        );
    }
    if output.pbData.is_null() || output.cbData == 0 {
        return Err("DPAPI 解密返回空数据".into());
    }
    let out = unsafe {
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let v = slice.to_vec();
        LocalFree(output.pbData as _);
        v
    };
    Ok(out)
}

/// 非 Windows：AES-256-GCM，密钥存于同目录（权限依赖系统）
#[cfg(not(windows))]
fn aes_key_path() -> PathBuf {
    data_dir().join("pg-migrate.key")
}

#[cfg(not(windows))]
fn load_or_create_aes_key() -> Result<[u8; 32], String> {
    use rand::RngCore;
    let path = aes_key_path();
    if path.exists() {
        let raw = fs::read(&path).map_err(|e| e.to_string())?;
        if raw.len() != 32 {
            return Err("pg-migrate.key 损坏".into());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&raw);
        return Ok(key);
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    fs::write(&path, key).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

#[cfg(not(windows))]
fn protect_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use rand::RngCore;
    let key = load_or_create_aes_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plain)
        .map_err(|e| format!("AES 加密失败: {e}"))?;
    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

#[cfg(not(windows))]
fn unprotect_bytes(blob: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    if blob.len() < 13 {
        return Err("密文过短".into());
    }
    let key = load_or_create_aes_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let (nonce_bytes, ct) = blob.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ct)
        .map_err(|_| "AES 解密失败".into())
}

fn encrypt_store_json(plain_json: &str) -> Result<VaultFile, String> {
    let cipher = protect_bytes(plain_json.as_bytes())?;
    Ok(VaultFile {
        v: 1,
        alg: if cfg!(windows) {
            "dpapi".into()
        } else {
            "aes-gcm".into()
        },
        nonce: String::new(),
        data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &cipher),
    })
}

fn decrypt_vault(vault: &VaultFile) -> Result<String, String> {
    let cipher = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &vault.data)
        .map_err(|e| format!("vault base64 无效: {e}"))?;
    let plain = unprotect_bytes(&cipher)?;
    String::from_utf8(plain).map_err(|e| format!("vault UTF-8 无效: {e}"))
}

fn load_store() -> PgMigrateStore {
    let vault_path = store_path_vault();
    if vault_path.exists() {
        if let Ok(raw) = fs::read_to_string(&vault_path) {
            if let Ok(vault) = serde_json::from_str::<VaultFile>(&raw) {
                if let Ok(plain) = decrypt_vault(&vault) {
                    if let Ok(store) = serde_json::from_str::<PgMigrateStore>(&plain) {
                        return store;
                    }
                }
            }
        }
        return PgMigrateStore::default();
    }

    // 迁移旧明文文件 → 加密保险库
    let plain_path = store_path_plain();
    if plain_path.exists() {
        if let Ok(raw) = fs::read_to_string(&plain_path) {
            if let Ok(store) = serde_json::from_str::<PgMigrateStore>(&raw) {
                let _ = save_store(&store);
                let bak = data_dir().join("pg-migrate.json.bak");
                let _ = fs::rename(&plain_path, &bak);
                return store;
            }
        }
    }
    PgMigrateStore::default()
}

fn save_store(store: &PgMigrateStore) -> Result<(), String> {
    let _ = fs::create_dir_all(data_dir());
    let plain = serde_json::to_string(store).map_err(|e| e.to_string())?;
    let vault = encrypt_store_json(&plain)?;
    let raw = serde_json::to_string_pretty(&vault).map_err(|e| e.to_string())?;
    fs::write(store_path_vault(), raw).map_err(|e| e.to_string())?;
    // 若仍有明文，改名备份避免残留密码
    let plain_path = store_path_plain();
    if plain_path.exists() {
        let bak = data_dir().join("pg-migrate.json.bak");
        let _ = fs::rename(&plain_path, &bak);
    }
    Ok(())
}

#[derive(Debug, Clone)]
enum PgTool {
    /// 原生可执行文件路径或命令名
    Native(String),
    /// 通过 `wsl` 调用 Linux 侧工具（如 psql / pg_dump）
    Wsl { tool: String },
}

fn resolve_tool(bin_dir: &str, name: &str) -> PgTool {
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    if let Some(path) = find_pg_tool(bin_dir, &exe) {
        return PgTool::Native(path.to_string_lossy().to_string());
    }
    #[cfg(windows)]
    if wsl_has_tool(name) {
        return PgTool::Wsl {
            tool: name.to_string(),
        };
    }
    // 保留裸命令，让 Command 返回系统原始错误
    PgTool::Native(exe)
}

/// 兼容旧测试与调试：返回原生路径或 `wsl:<tool>`
#[allow(dead_code)]
fn resolve_bin(bin_dir: &str, name: &str) -> String {
    match resolve_tool(bin_dir, name) {
        PgTool::Native(p) => p,
        PgTool::Wsl { tool } => format!("wsl:{tool}"),
    }
}

fn pg_tool_candidate_dirs(configured: &str) -> Vec<(PathBuf, &'static str)> {
    let mut dirs = Vec::new();
    if !configured.trim().is_empty() {
        dirs.push((PathBuf::from(configured.trim()), "手动设置"));
    }

    // 随 Quickbar 分发时可将官方客户端文件放到 postgres/bin 或 resources/postgres/bin。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push((parent.join("postgres").join("bin"), "Quickbar 内置"));
            dirs.push((
                parent.join("resources").join("postgres").join("bin"),
                "Quickbar 内置",
            ));
        }
    }

    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path).map(|p| (p, "系统 PATH")));
    }

    #[cfg(windows)]
    for base_var in ["ProgramFiles", "ProgramFiles(x86)"] {
        let Some(base) = std::env::var_os(base_var) else {
            continue;
        };
        let pg_root = PathBuf::from(base).join("PostgreSQL");
        let Ok(versions) = fs::read_dir(pg_root) else {
            continue;
        };
        let mut version_dirs: Vec<PathBuf> = versions
            .flatten()
            .map(|entry| entry.path().join("bin"))
            .collect();
        // 优先较新版本。目录通常是 17、16、15。
        version_dirs.sort_by(|a, b| b.cmp(a));
        dirs.extend(
            version_dirs
                .into_iter()
                .map(|p| (p, "PostgreSQL 安装目录")),
        );
    }

    dirs
}

fn find_pg_tool(configured: &str, exe: &str) -> Option<PathBuf> {
    pg_tool_candidate_dirs(configured)
        .into_iter()
        .map(|(dir, _)| dir.join(exe))
        .find(|path| path.is_file())
}

#[cfg(windows)]
fn wsl_available() -> bool {
    let mut cmd = Command::new("wsl");
    cmd.args(["-e", "true"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

#[cfg(windows)]
fn wsl_has_tool(name: &str) -> bool {
    if !wsl_available() {
        return false;
    }
    let mut cmd = Command::new("wsl");
    // `command -v` 比 which 更通用
    cmd.args(["-e", "sh", "-lc", &format!("command -v {name} >/dev/null 2>&1")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

#[cfg(windows)]
fn wsl_tool_path(name: &str) -> Option<String> {
    let mut cmd = Command::new("wsl");
    cmd.args(["-e", "sh", "-lc", &format!("command -v {name}")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Windows 路径 → WSL `/mnt/<drive>/...`
fn to_wsl_path(path: &str) -> String {
    let p = path.trim();
    if p.len() >= 2 && p.as_bytes()[1] == b':' {
        let drive = p.chars().next().unwrap().to_ascii_lowercase();
        let rest = p[2..].replace('\\', "/");
        let rest = if rest.starts_with('/') {
            rest
        } else {
            format!("/{rest}")
        };
        return format!("/mnt/{drive}{rest}");
    }
    p.replace('\\', "/")
}

/// 判断参数是否像 Windows 绝对路径（需要转给 WSL）
fn looks_like_windows_path(arg: &str) -> bool {
    let a = arg.trim();
    a.len() >= 3 && a.as_bytes()[1] == b':' && (a.as_bytes()[2] == b'\\' || a.as_bytes()[2] == b'/')
}

/// WSL 里 `localhost` / `127.0.0.1` 指向 Linux 自身，不是 Windows 主机。
/// 用 resolv.conf 的 nameserver（WSL2 默认网关 / Windows 宿主机）替换。
#[cfg(windows)]
fn wsl_windows_host_ip() -> Option<String> {
    let mut cmd = Command::new("wsl");
    cmd.args([
        "-e",
        "sh",
        "-lc",
        "awk '/nameserver/{print $2; exit}' /etc/resolv.conf",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if ip.is_empty() {
        None
    } else {
        Some(ip)
    }
}

fn adapt_args_for_wsl(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut i = 0;
    #[cfg(windows)]
    let win_host = wsl_windows_host_ip();
    while i < args.len() {
        let arg = &args[i];
        // -h localhost → Windows 宿主机 IP（仅 WSL）
        #[cfg(windows)]
        if arg == "-h" {
            out.push(arg.clone());
            i += 1;
            if i < args.len() {
                let host = args[i].trim();
                if host == "127.0.0.1" || host.eq_ignore_ascii_case("localhost") {
                    if let Some(ip) = win_host.as_ref() {
                        out.push(ip.clone());
                    } else {
                        out.push(args[i].clone());
                    }
                } else {
                    out.push(args[i].clone());
                }
                i += 1;
            }
            continue;
        }
        if looks_like_windows_path(arg) || (arg == "-f" && i + 1 < args.len()) {
            if arg == "-f" {
                out.push(arg.clone());
                i += 1;
                if i < args.len() {
                    out.push(to_wsl_path(&args[i]));
                    i += 1;
                }
                continue;
            }
            out.push(to_wsl_path(arg));
            i += 1;
            continue;
        }
        out.push(arg.clone());
        i += 1;
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgToolsStatus {
    pub available: bool,
    pub source: String,
    pub bin_dir: String,
    pub psql_path: String,
    pub pg_dump_path: String,
}

/// 自动发现 psql / pg_dump；前端默认无需用户填写路径。
/// 探测要跑外部进程（含 WSL），放后台线程避免阻塞 UI
#[tauri::command]
pub async fn pg_detect_tools() -> PgToolsStatus {
    tauri::async_runtime::spawn_blocking(detect_tools_blocking)
        .await
        .unwrap_or_else(|_| PgToolsStatus {
            available: false,
            source: "检测失败".into(),
            bin_dir: String::new(),
            psql_path: String::new(),
            pg_dump_path: String::new(),
        })
}

fn detect_tools_blocking() -> PgToolsStatus {
    let store = load_store();
    let psql_exe = if cfg!(windows) { "psql.exe" } else { "psql" };
    let dump_exe = if cfg!(windows) {
        "pg_dump.exe"
    } else {
        "pg_dump"
    };

    for (dir, source) in pg_tool_candidate_dirs(&store.bin_dir) {
        let psql = dir.join(psql_exe);
        let dump = dir.join(dump_exe);
        if psql.is_file() && dump.is_file() {
            return PgToolsStatus {
                available: true,
                source: source.to_string(),
                bin_dir: dir.to_string_lossy().to_string(),
                psql_path: psql.to_string_lossy().to_string(),
                pg_dump_path: dump.to_string_lossy().to_string(),
            };
        }
    }

    #[cfg(windows)]
    {
        let psql = wsl_tool_path("psql");
        let dump = wsl_tool_path("pg_dump");
        if let (Some(psql), Some(dump)) = (psql, dump) {
            return PgToolsStatus {
                available: true,
                source: "WSL".into(),
                bin_dir: "(wsl)".into(),
                psql_path: format!("wsl:{psql}"),
                pg_dump_path: format!("wsl:{dump}"),
            };
        }
    }

    PgToolsStatus {
        available: false,
        source: "未找到".into(),
        bin_dir: String::new(),
        psql_path: String::new(),
        pg_dump_path: String::new(),
    }
}

fn run_captured(
    program: &str,
    args: &[String],
    env: &HashMap<String, String>,
) -> Result<ProcessResult, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env {
        cmd.env(k, v);
    }
    // Windows 下避免弹出控制台窗口
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().map_err(|e| {
        format!(
            "无法启动 {program}: {e}。未自动找到 PostgreSQL 命令行工具；\
             可安装 Windows 客户端、在 WSL 安装 postgresql-client，或在高级设置中指定 bin 目录。"
        )
    })?;
    Ok(ProcessResult {
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn run_pg_tool(
    tool: &PgTool,
    args: &[String],
    env: &HashMap<String, String>,
) -> Result<ProcessResult, String> {
    match tool {
        PgTool::Native(program) => run_captured(program, args, env),
        PgTool::Wsl { tool } => {
            // wsl -e env KEY=VAL ... tool args...
            // 用 env 传递密码，避免写进 bash -c 字符串
            let mut wsl_args = vec!["-e".into(), "env".into()];
            for (k, v) in env {
                wsl_args.push(format!("{k}={v}"));
            }
            wsl_args.push(tool.clone());
            wsl_args.extend(adapt_args_for_wsl(args));
            run_captured("wsl", &wsl_args, &HashMap::new())
        }
    }
}

fn find_conn<'a>(store: &'a PgMigrateStore, id: &str) -> Result<&'a PgConnection, String> {
    store
        .connections
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("连接不存在: {id}"))
}

fn pg_env(conn: &PgConnection) -> HashMap<String, String> {
    let mut env = HashMap::new();
    env.insert("PGPASSWORD".into(), conn.password.clone());
    env.insert("PGCLIENTENCODING".into(), "UTF8".into());
    env
}

fn base_args(conn: &PgConnection) -> Vec<String> {
    vec![
        "-h".into(),
        conn.host.clone(),
        "-p".into(),
        conn.port.to_string(),
        "-U".into(),
        conn.user.clone(),
        "-d".into(),
        conn.database.clone(),
    ]
}

#[tauri::command]
pub fn pg_list_connections() -> Result<PgMigrateStore, String> {
    let _ = crate::config::ensure_data_dirs();
    Ok(load_store())
}

#[tauri::command]
pub fn pg_save_connections(store: PgMigrateStore) -> Result<PgMigrateStore, String> {
    let _ = crate::config::ensure_data_dirs();
    // 规范化：去掉空 id
    let mut next = store;
    next.connections.retain(|c| !c.id.trim().is_empty());
    save_store(&next)?;
    Ok(next)
}

/// 用当前表单里的连接参数测通（无需先保存）
#[tauri::command]
pub async fn pg_test_connection(connection: PgConnection) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || test_connection_blocking(connection))
        .await
        .map_err(|e| format!("测试任务失败: {e}"))?
}

fn test_connection_blocking(connection: PgConnection) -> Result<String, String> {
    if connection.host.trim().is_empty() {
        return Err("请填写 Host".into());
    }
    if connection.user.trim().is_empty() {
        return Err("请填写用户".into());
    }
    if connection.database.trim().is_empty() {
        return Err("请填写数据库名".into());
    }
    let store = load_store();
    let psql = resolve_tool(&store.bin_dir, "psql");
    let mut args = base_args(&connection);
    args.extend([
        "-t".into(),
        "-A".into(),
        "-v".into(),
        "ON_ERROR_STOP=1".into(),
        "-c".into(),
        "SELECT current_database() || ' @ ' || version();".into(),
    ]);
    let result = run_pg_tool(&psql, &args, &pg_env(&connection))?;
    if result.code != 0 {
        let detail = result.stderr.trim();
        return Err(if detail.is_empty() {
            format!("连接失败 (exit {})", result.code)
        } else {
            format!("连接失败:\n{detail}")
        });
    }
    let info = result.stdout.lines().map(str::trim).find(|s| !s.is_empty());
    Ok(match info {
        Some(s) => format!("连通成功：{s}"),
        None => "连通成功".into(),
    })
}

/// 列出数据库 schema（排除系统 schema）
#[tauri::command]
pub async fn pg_list_schemas(connection_id: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || list_schemas_blocking(&connection_id))
        .await
        .map_err(|e| format!("查询任务失败: {e}"))?
}

fn list_schemas_blocking(connection_id: &str) -> Result<Vec<String>, String> {
    let store = load_store();
    let conn = find_conn(&store, &connection_id)?;
    let psql = resolve_tool(&store.bin_dir, "psql");
    let mut args = base_args(conn);
    args.extend([
        "-t".into(),
        "-A".into(),
        "-c".into(),
        "SELECT nspname FROM pg_catalog.pg_namespace \
         WHERE nspname NOT LIKE 'pg\\_%' \
           AND nspname <> 'information_schema' \
         ORDER BY 1;"
            .into(),
    ]);
    let result = run_pg_tool(&psql, &args, &pg_env(conn))?;
    if result.code != 0 {
        return Err(format!(
            "列出 schema 失败 (exit {}):\n{}",
            result.code,
            result.stderr.trim()
        ));
    }
    let list = result
        .stdout
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(list)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PgMigrateRequest {
    pub source_id: String,
    pub target_id: String,
    /// 源库 schema（pg_dump -n）；空则 public
    #[serde(default)]
    pub source_schema: String,
    /// 目标库 schema；空则与源相同
    #[serde(default)]
    pub target_schema: String,
    /// 兼容旧前端：仅传 schema 时视为源=目标
    #[serde(default)]
    pub schema: String,
    /// full | schemaOnly | dataOnly
    pub mode: String,
    /// 是否带 --clean --if-exists
    #[serde(default = "default_true")]
    pub clean: bool,
    /// 导入前在目标库 CREATE SCHEMA IF NOT EXISTS
    #[serde(default = "default_true")]
    pub ensure_schema: bool,
    /// 整体重建目标 schema：把 dump 里的 DROP SCHEMA 改成 CASCADE（会删光该 schema）
    #[serde(default)]
    pub recreate_schema: bool,
    /// 导出 SQL 路径；空则写到临时文件
    #[serde(default)]
    pub dump_path: String,
    /// 仅导出不导入
    #[serde(default)]
    pub dump_only: bool,
    /// 单步审核：每步执行前等待前端确认
    #[serde(default)]
    pub review: bool,
    /// 审核会话 id（由前端生成，用于 reply）
    #[serde(default)]
    pub session_id: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PgMigrateResult {
    pub dump_path: String,
    /// 本次迁移逐步日志文件路径
    #[serde(default)]
    pub log_path: String,
    /// 完整迁移日志文本
    #[serde(default)]
    pub log: String,
    pub dump: ProcessResult,
    pub ensure_schema: Option<ProcessResult>,
    pub restore: Option<ProcessResult>,
}

fn validate_schema_name(name: &str) -> Result<String, String> {
    let s = name.trim();
    let s = if s.is_empty() { "public" } else { s };
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(format!("schema 名称含非法字符: {s}"));
    }
    Ok(s.to_string())
}

/// 将 dump SQL 中的源 schema 改写成目标 schema（同名则原样返回）
fn remap_schema_in_sql(sql: &str, from: &str, to: &str) -> String {
    if from == to {
        return sql.to_string();
    }
    let mut out = sql.replace(&format!("\"{from}\""), &format!("\"{to}\""));
    // 常见未加引号写法（整词替换，避免 app → app_dev 误伤）
    for (a, b) in [
        (format!("SCHEMA {from}"), format!("SCHEMA {to}")),
        (format!("schema {from}"), format!("schema {to}")),
        (format!("search_path = {from}"), format!("search_path = {to}")),
        (format!("search_path TO {from}"), format!("search_path TO {to}")),
        (format!("search_path to {from}"), format!("search_path to {to}")),
    ] {
        out = replace_whole_token(&out, &a, &b);
    }
    out
}

fn replace_whole_token(haystack: &str, from: &str, to: &str) -> String {
    if from.is_empty() || !haystack.contains(from) {
        return haystack.to_string();
    }
    let mut result = String::with_capacity(haystack.len());
    let bytes = haystack.as_bytes();
    let needle = from.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if i + needle.len() <= bytes.len() && &bytes[i..i + needle.len()] == needle {
            let before_ok = i == 0 || !is_ident_byte(bytes[i - 1]);
            let after_idx = i + needle.len();
            let after_ok = after_idx >= bytes.len() || !is_ident_byte(bytes[after_idx]);
            if before_ok && after_ok {
                result.push_str(to);
                i = after_idx;
                continue;
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

#[tauri::command]
pub async fn pg_migrate(app: AppHandle, req: PgMigrateRequest) -> Result<PgMigrateResult, String> {
    tauri::async_runtime::spawn_blocking(move || migrate_blocking(app, req))
        .await
        .map_err(|e| format!("迁移任务失败: {e}"))?
}

fn migrate_blocking(app: AppHandle, req: PgMigrateRequest) -> Result<PgMigrateResult, String> {
    let review = req.review;
    let session_id = if review {
        let id = req.session_id.trim().to_string();
        if id.is_empty() {
            return Err("单步审核需要 sessionId".into());
        }
        id
    } else {
        req.session_id.trim().to_string()
    };

    let store = load_store();
    let source = find_conn(&store, &req.source_id)?.clone();
    let target = find_conn(&store, &req.target_id)?.clone();

    // 兼容旧字段 schema：两边都没传时用它
    let legacy = req.schema.trim();
    let source_schema = validate_schema_name(if !req.source_schema.trim().is_empty() {
        req.source_schema.trim()
    } else if !legacy.is_empty() {
        legacy
    } else {
        "public"
    })?;
    let target_schema = validate_schema_name(if !req.target_schema.trim().is_empty() {
        req.target_schema.trim()
    } else {
        // 未指定目标时与源相同
        source_schema.as_str()
    })?;

    let dump_path = if req.dump_path.trim().is_empty() {
        let dir = data_dir().join("pg-dumps");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let stamp = chrono_like_stamp();
        let name = if source_schema == target_schema {
            format!("{source_schema}-{stamp}.sql")
        } else {
            format!("{source_schema}-to-{target_schema}-{stamp}.sql")
        };
        dir.join(name).to_string_lossy().to_string()
    } else {
        req.dump_path.trim().to_string()
    };

    if let Some(parent) = PathBuf::from(&dump_path).parent() {
        let _ = fs::create_dir_all(parent);
    }

    let log_path = PathBuf::from(&dump_path).with_extension("log");
    let app_for_clear = app.clone();
    let session_for_clear = session_id.clone();
    let mut logger = MigrateLogger::new(app.clone(), log_path);

    let finish_err = |logger: &mut MigrateLogger, msg: String| -> Result<PgMigrateResult, String> {
        clear_review_wait(&app_for_clear, &session_for_clear);
        logger.error("失败", &msg);
        Err(format!("{msg}\n\n完整日志: {}", logger.path_str()))
    };

    let mode_label = match req.mode.as_str() {
        "schemaOnly" => "仅结构 (schema-only)",
        "dataOnly" => "仅数据 (data-only)",
        _ => "结构+数据 (full)",
    };

    logger.info("准备", "开始 PostgreSQL 迁移任务");
    if review {
        logger.info("准备", format!("单步审核已开启（session={session_id}）"));
    }
    logger.info("准备", format!("源库: {}", conn_summary(&source)));
    if req.dump_only {
        logger.info("准备", "模式: 仅导出（不导入目标）");
    } else {
        logger.info("准备", format!("目标库: {}", conn_summary(&target)));
    }
    logger.info(
        "准备",
        format!(
            "schema: {source_schema} → {target_schema}；内容: {mode_label}；\
             clean={clean}；ensureSchema={ensure}；dumpOnly={dump_only}；review={review}",
            clean = req.clean,
            ensure = req.ensure_schema,
            dump_only = req.dump_only,
        ),
    );
    logger.info("准备", format!("SQL 输出: {dump_path}"));
    logger.info("准备", format!("日志文件: {}", logger.path_str()));

    if req.clean && req.mode == "dataOnly" {
        logger.warn(
            "准备",
            "--clean 与 --data-only 不能同时使用，已忽略 clean",
        );
    }
    if source.id == target.id && !req.dump_only {
        logger.warn("准备", "源与目标为同一连接");
    }

    let mut plan_risks: Vec<String> = Vec::new();
    let mut target_has_schema = false;
    if !req.dump_only {
        match target_schema_exists(&store, &target, &target_schema) {
            Ok(exists) => {
                target_has_schema = exists;
                if exists {
                    logger.warn(
                        "准备",
                        format!("目标库已存在 schema `{target_schema}`"),
                    );
                    if !req.clean || req.mode == "dataOnly" {
                        plan_risks.push(format!(
                            "测试/目标库里已经有「{target_schema}」这个分区（schema）。\
                             你没勾「清理同名对象」，导入时不会先删旧表；如果表也重名，后面还可能报错。"
                        ));
                    } else {
                        plan_risks.push(format!(
                            "目标库里已经有「{target_schema}」。你勾了「清理同名对象」，\
                             导入时会先删掉目标里同名的表/视图，再用这次导出的内容覆盖。\
                             目标里同名对象的数据会丢。"
                        ));
                    }
                } else {
                    logger.info(
                        "准备",
                        format!("目标库尚无 schema `{target_schema}`"),
                    );
                }
            }
            Err(e) => {
                logger.warn("准备", format!("无法预检目标 schema：{e}"));
                plan_risks.push(format!(
                    "没法提前确认目标库里有没有「{target_schema}」（{e}）。请自行确认目标没错。"
                ));
            }
        }
    }
    if req.recreate_schema && !req.dump_only {
        plan_risks.push(format!(
            "已开启「整体重建」：导入前会把目标「{target_schema}」连同里面所有表和数据一起删除，\
             这一步不可撤销。"
        ));
    }
    if source.id == target.id && !req.dump_only {
        plan_risks.push(
            "源库和目标库是同一个连接：迁完等于把内容写回自己，容易覆盖已有数据。".into(),
        );
    }
    if req.clean && req.mode != "dataOnly" {
        plan_risks.push(
            "已开启「清理同名对象」：导入时会删除目标库里同名的表/视图，请确认目标库可以覆盖。"
                .into(),
        );
    }

    let will_remap = source_schema != target_schema;
    let will_ensure = !req.dump_only && req.ensure_schema && target_schema != "public";
    // plan + dump + [remap] + [soften约] + [ensure] + [restore]
    let mut step_total: u32 = 2;
    if will_remap {
        step_total += 1;
    }
    if !req.dump_only {
        step_total += 1; // soften（可能跳过，总数仅作约数）
        if will_ensure {
            step_total += 1;
        }
        step_total += 1; // restore
    }
    let mut step_i: u32 = 0;
    let mut next_step = || {
        step_i += 1;
        step_i
    };

    let content_plain = match req.mode.as_str() {
        "schemaOnly" => "只迁表结构（不含数据）",
        "dataOnly" => "只迁数据（不改表结构）",
        _ => "表结构 + 数据一起迁",
    };
    let source_plain = conn_summary(&source);
    let target_plain = if req.dump_only {
        "不导入任何库（只导出文件）".to_string()
    } else {
        conn_summary(&target)
    };

    let plan_summary = if req.dump_only {
        format!(
            "接下来只会从源库导出「{source_schema}」的内容，保存成 SQL 文件，不会改任何数据库。\n\n\
             导出内容：{content_plain}\n\
             现在还没开始干活，请先确认「从哪导出、导出什么」是否正确。"
        )
    } else {
        format!(
            "接下来会把源库里的「{source_schema}」拷到目标库的「{target_schema}」。\n\n\
             拷贝内容：{content_plain}\n\
             现在还没改任何数据库，只是让你核对：源、目标、schema、是否清理旧对象，有没有选错。"
        )
    };
    let plan_detail = format!(
        "从哪里拷：{source_plain}\n\
         拷到哪里：{target_plain}\n\
         Schema：{source_schema} → {target_schema}\n\
         内容：{content_plain}\n\
         导入前清理同名对象：{}\n\
         整体重建目标 schema：{}\n\
         目标没有 schema 时自动创建：{}\n\
         导出文件将保存到：\n{dump_path}",
        if req.clean && req.mode != "dataOnly" {
            "是（会删目标同名表再写入）"
        } else {
            "否"
        },
        if req.recreate_schema && !req.dump_only {
            "是（先整体删除该 schema 及其全部内容）"
        } else {
            "否"
        },
        if req.ensure_schema { "是" } else { "否" },
    );

    if let Err(e) = await_review(
        &app,
        &mut logger,
        &session_id,
        review,
        "plan",
        next_step(),
        step_total,
        "先核对这次要迁什么",
        &plan_summary,
        &plan_detail,
        plan_risks,
        "点「确认继续」只表示计划没问题，下一步才会真正开始导出。",
    ) {
        return finish_err(&mut logger, e);
    }

    let pg_dump = resolve_tool(&store.bin_dir, "pg_dump");
    let mut dump_args = base_args(&source);
    dump_args.extend(["-n".into(), source_schema.clone()]);
    match req.mode.as_str() {
        "schemaOnly" => dump_args.push("--schema-only".into()),
        "dataOnly" => dump_args.push("--data-only".into()),
        _ => {}
    }
    // pg_dump 不允许 --clean 与 --data-only 同时出现
    if req.clean && req.mode != "dataOnly" {
        dump_args.extend(["--clean".into(), "--if-exists".into()]);
    }
    dump_args.extend([
        "-v".into(),
        "--no-owner".into(),
        "--no-privileges".into(),
        "-f".into(),
        dump_path.clone(),
    ]);

    let dump_summary = format!(
        "即将从源库读取「{source_schema}」，导出成 SQL 文件。\n\n\
         这一步只读源库、写本地文件，不会改目标库。\n\
         导出内容：{content_plain}"
    );
    let dump_detail = format!(
        "源库：{source_plain}\n\
         导出工具：{}\n\
         文件保存到：\n{dump_path}",
        tool_label(&pg_dump),
    );
    if let Err(e) = await_review(
        &app,
        &mut logger,
        &session_id,
        review,
        "dump",
        next_step(),
        step_total,
        "开始从源库导出",
        &dump_summary,
        &dump_detail,
        vec![],
        "点「确认继续」后才会开始导出（可能需要一点时间）。",
    ) {
        return finish_err(&mut logger, e);
    }

    logger.info(
        "导出",
        format!(
            "工具: {}；命令参数: {}",
            tool_label(&pg_dump),
            format_args(&dump_args)
        ),
    );
    logger.info("导出", "正在执行 pg_dump…");

    let dump = match run_pg_tool(&pg_dump, &dump_args, &pg_env(&source)) {
        Ok(r) => r,
        Err(e) => return finish_err(&mut logger, e),
    };
    if !dump.stdout.trim().is_empty() {
        logger.info("导出", format!("stdout:\n{}", trim_output(&dump.stdout, 4000)));
    }
    if !dump.stderr.trim().is_empty() {
        logger.info("导出", format!("stderr:\n{}", trim_output(&dump.stderr, 8000)));
    }
    if dump.code != 0 {
        let msg = format!(
            "pg_dump 失败 (exit {}):\n{}",
            dump.code,
            dump.stderr.trim()
        );
        return finish_err(&mut logger, msg);
    }

    let dump_size = fs::metadata(&dump_path).map(|m| m.len()).unwrap_or(0);
    logger.ok(
        "导出",
        format!(
            "pg_dump 完成 (exit 0)，SQL 大小 {}",
            format_bytes(dump_size)
        ),
    );

    // 源/目标 schema 不同时，改写 SQL 再导入
    if will_remap {
        let remap_summary = format!(
            "导出文件里写的还是源库名字「{source_schema}」，但你要导入的目标叫「{target_schema}」。\n\n\
             这一步会改本地 SQL 文件里的名字，让它匹配目标；还不会动目标数据库。"
        );
        let remap_detail = format!(
            "改名：{source_schema} → {target_schema}\n文件：\n{dump_path}"
        );
        if let Err(e) = await_review(
            &app,
            &mut logger,
            &session_id,
            review,
            "remap",
            next_step(),
            step_total,
            "把导出文件里的 schema 名改成目标名",
            &remap_summary,
            &remap_detail,
            vec!["只会改你电脑上的导出文件，确认名字没写反即可。".into()],
            "点「确认继续」后会改写本地 SQL 文件。",
        ) {
            return finish_err(&mut logger, e);
        }

        logger.info(
            "改写",
            format!("将 SQL 中的 schema `{source_schema}` 映射为 `{target_schema}`"),
        );
        let sql = match fs::read_to_string(&dump_path) {
            Ok(s) => s,
            Err(e) => return finish_err(&mut logger, format!("读取 dump 失败: {e}")),
        };
        let before_len = sql.len();
        let rewritten = remap_schema_in_sql(&sql, &source_schema, &target_schema);
        let after_len = rewritten.len();
        if let Err(e) = fs::write(&dump_path, &rewritten) {
            return finish_err(&mut logger, format!("写入改写 dump 失败: {e}"));
        }
        logger.ok(
            "改写",
            format!(
                "改写完成（{before} → {after}）",
                before = format_bytes(before_len as u64),
                after = format_bytes(after_len as u64),
            ),
        );
    } else {
        logger.info("改写", "源/目标 schema 同名，跳过 SQL 改写");
    }

    if req.dump_only {
        clear_review_wait(&app, &session_id);
        logger.ok(
            "完成",
            format!(
                "仅导出完成，总耗时 {} ms；SQL: {dump_path}",
                logger.elapsed_ms()
            ),
        );
        return Ok(PgMigrateResult {
            dump_path,
            log_path: logger.path_str(),
            log: logger.text(),
            dump,
            ensure_schema: None,
            restore: None,
        });
    }

    // 导入前修补导出文件：
    // 1) CREATE SCHEMA → IF NOT EXISTS，避免「schema already exists」
    // 2) 整库 DROP SCHEMA 默认注释掉（不带 CASCADE 时会被依赖对象挡住），或按需改成 CASCADE
    {
        let sql = match fs::read_to_string(&dump_path) {
            Ok(s) => s,
            Err(e) => return finish_err(&mut logger, format!("读取 dump 失败: {e}")),
        };
        let (patched, created) = soften_create_schema_statements(&sql);
        let (patched, dropped) =
            adjust_drop_schema_statements(&patched, &target_schema, req.recreate_schema);

        if created > 0 || dropped > 0 {
            let mut summary = String::from(
                "导出文件里有几处语句直接执行容易失败，这一步先在本地把它们改好。\n\n",
            );
            if created > 0 {
                summary.push_str(&format!(
                    "· {created} 处「创建 schema」改成「没有才创建」，目标已有同名 schema 时不再报错。\n"
                ));
            }
            if dropped > 0 {
                if req.recreate_schema {
                    summary.push_str(&format!(
                        "· {dropped} 处「删除整个 schema」改成连同里面所有对象一起删（CASCADE），\
                         等于把目标「{target_schema}」推倒重建。\n"
                    ));
                } else {
                    summary.push_str(&format!(
                        "· {dropped} 处「删除整个 schema」被注释掉。\
                         这类语句不带 CASCADE，只要目标里还有表依赖它就会失败；\
                         同名表仍会被各自的删除语句清掉。\n"
                    ));
                }
            }
            summary.push_str("\n只改你电脑上的文件，还不会写入目标库。");

            let detail = format!(
                "创建语句改写：{created} 处\n整库删除语句：{dropped} 处（{}）\n\
                 目标里是否已有「{target_schema}」：{}\n文件：\n{dump_path}",
                if req.recreate_schema {
                    "改为 CASCADE 整体重建"
                } else {
                    "已注释跳过"
                },
                if target_has_schema { "是" } else { "否 / 未知" },
            );

            let mut risks: Vec<String> = Vec::new();
            if dropped > 0 && req.recreate_schema {
                risks.push(format!(
                    "你开了「整体重建」：目标「{target_schema}」里现有的表和数据会被全部删除，无法恢复。"
                ));
            }
            if target_has_schema && !(req.clean && req.mode != "dataOnly") {
                risks.push(
                    "目标已有该 schema 且你没开清理：如果表也重名，导入时仍可能报冲突。".into(),
                );
            }
            if risks.is_empty() {
                risks.push("这是安全修补，一般建议同意。".into());
            }

            if let Err(e) = await_review(
                &app,
                &mut logger,
                &session_id,
                review,
                "soften",
                next_step(),
                step_total,
                "先修补导出文件，避开已知的导入错误",
                &summary,
                &detail,
                risks,
                "点「确认继续」后只改本地 SQL，仍不会写入目标库。",
            ) {
                return finish_err(&mut logger, e);
            }
            if let Err(e) = fs::write(&dump_path, patched) {
                return finish_err(&mut logger, format!("写入修补后的 dump 失败: {e}"));
            }
            if created > 0 {
                logger.ok(
                    "修补",
                    format!("已将 {created} 处 CREATE SCHEMA 改为 IF NOT EXISTS"),
                );
            }
            if dropped > 0 {
                logger.ok(
                    "修补",
                    if req.recreate_schema {
                        format!("已将 {dropped} 处 DROP SCHEMA 改为 CASCADE")
                    } else {
                        format!("已注释 {dropped} 处 DROP SCHEMA（避免依赖对象阻塞）")
                    },
                );
            }
        } else {
            // 预估里算了修补步，跳过时把总数减一，避免进度虚高
            if step_total > 0 {
                step_total -= 1;
            }
            logger.info("修补", "dump 无需修补，跳过");
        }
    }

    let psql = resolve_tool(&store.bin_dir, "psql");
    logger.info("导入", format!("工具: {}", tool_label(&psql)));

    let mut ensure_schema = None;
    if will_ensure {
        let sql = format!(
            "CREATE SCHEMA IF NOT EXISTS \"{}\" AUTHORIZATION CURRENT_USER;",
            target_schema.replace('"', "")
        );
        let mut args = base_args(&target);
        args.extend(["-v".into(), "ON_ERROR_STOP=1".into(), "-c".into(), sql.clone()]);
        let ensure_summary = format!(
            "即将在目标库里准备好「{target_schema}」这个分区（没有就创建，有则跳过）。\n\n\
             这是写入目标库的第一步，但只建空壳 schema，还不会导入表和数据。"
        );
        let ensure_detail = format!("目标库：{target_plain}\n将执行：{sql}");
        if let Err(e) = await_review(
            &app,
            &mut logger,
            &session_id,
            review,
            "ensure_schema",
            next_step(),
            step_total,
            "在目标库准备 schema（没有就创建）",
            &ensure_summary,
            &ensure_detail,
            vec!["对目标库有一次很小的写入（建 schema）。".into()],
            "点「确认继续」后会在目标库执行创建 schema。",
        ) {
            return finish_err(&mut logger, e);
        }

        logger.info(
            "建库",
            format!("在目标库执行: {sql}；参数: {}", format_args(&args)),
        );
        let r = match run_pg_tool(&psql, &args, &pg_env(&target)) {
            Ok(r) => r,
            Err(e) => return finish_err(&mut logger, e),
        };
        if !r.stderr.trim().is_empty() {
            logger.info("建库", format!("stderr:\n{}", trim_output(&r.stderr, 4000)));
        }
        if r.code != 0 {
            let msg = format!(
                "目标库 CREATE SCHEMA 失败 (exit {}):\n{}",
                r.code,
                r.stderr.trim()
            );
            return finish_err(&mut logger, msg);
        }
        logger.ok("建库", "CREATE SCHEMA 完成");
        ensure_schema = Some(r);
    } else if !req.ensure_schema {
        logger.info("建库", "已关闭 ensureSchema，跳过 CREATE SCHEMA");
    } else {
        logger.info("建库", "目标为 public，跳过 CREATE SCHEMA");
    }

    let mut restore_args = base_args(&target);
    restore_args.extend([
        "-v".into(),
        "ON_ERROR_STOP=1".into(),
        "-f".into(),
        dump_path.clone(),
    ]);
    let preview = dump_sql_preview(&dump_path, 900);
    let mut restore_risks = vec![
        "点确认后会真正改目标库：写入表结构/数据。若选错目标，后果很难撤销。".into(),
    ];
    if req.clean && req.mode != "dataOnly" {
        restore_risks.push(
            "已开启清理：导入过程中会先删除目标里同名的表/视图，再写入新的。".into(),
        );
    }
    if target_has_schema && !(req.clean && req.mode != "dataOnly") {
        restore_risks.push(
            "目标里已有该 schema 且未清理：若表也同名，仍可能报「已存在」或主键冲突。".into(),
        );
    }
    let restore_summary = format!(
        "最后一步：把导出的 SQL 全部执行到目标库「{target_schema}」。\n\n\
         从：{source_plain}\n\
         到：{target_plain}\n\
         内容：{content_plain}\n\n\
         这是整次迁移唯一会大量改目标库的步骤，请再确认目标没错。"
    );
    let restore_detail = format!(
        "SQL 文件（{}）：\n{dump_path}\n\n—— 文件开头预览（便于核对）——\n{preview}",
        format_bytes(dump_size),
    );
    if let Err(e) = await_review(
        &app,
        &mut logger,
        &session_id,
        review,
        "restore",
        next_step(),
        step_total,
        "最后确认：写入目标库",
        &restore_summary,
        &restore_detail,
        restore_risks,
        "点「确认继续」后开始导入；点「取消迁移」则到此为止，目标库保持不动。",
    ) {
        return finish_err(&mut logger, e);
    }

    logger.info(
        "导入",
        format!(
            "正在执行 psql 导入；参数: {}",
            format_args(&restore_args)
        ),
    );
    let restore = match run_pg_tool(&psql, &restore_args, &pg_env(&target)) {
        Ok(r) => r,
        Err(e) => return finish_err(&mut logger, e),
    };
    if !restore.stdout.trim().is_empty() {
        logger.info(
            "导入",
            format!("stdout:\n{}", trim_output(&restore.stdout, 4000)),
        );
    }
    if !restore.stderr.trim().is_empty() {
        logger.info(
            "导入",
            format!("stderr:\n{}", trim_output(&restore.stderr, 8000)),
        );
    }
    if restore.code != 0 {
        let mut msg = format!(
            "psql 导入失败 (exit {}):\n{}\n\nSQL 文件: {dump_path}",
            restore.code,
            restore.stderr.trim()
        );
        if restore.stderr.contains("cannot drop schema") {
            msg.push_str(
                "\n\n提示: 目标 schema 里还有依赖对象，普通 DROP 删不掉。\
                 可勾选「整体重建目标 schema」（会删光该 schema 再导入），\
                 或换一个空的目标 schema。",
            );
        } else if restore.stderr.contains("already exists") {
            msg.push_str(
                "\n\n提示: 目标已有同名对象。可勾选「导入前先清理同名对象」，\
                 或换一个空的目标 schema 再试。",
            );
        }
        return finish_err(&mut logger, msg);
    }

    clear_review_wait(&app, &session_id);
    logger.ok(
        "完成",
        format!(
            "迁移成功，总耗时 {} ms；SQL: {dump_path}；日志: {}",
            logger.elapsed_ms(),
            logger.path_str()
        ),
    );

    Ok(PgMigrateResult {
        dump_path,
        log_path: logger.path_str(),
        log: logger.text(),
        dump,
        ensure_schema,
        restore: Some(restore),
    })
}

fn chrono_like_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_bin_空目录走_exe名或_wsl() {
        let p = resolve_bin("", "pg_dump");
        if cfg!(windows) {
            assert!(
                p == "pg_dump.exe" || p == "wsl:pg_dump",
                "unexpected resolve: {p}"
            );
        } else {
            assert_eq!(p, "pg_dump");
        }
    }

    #[test]
    fn to_wsl_path_转换盘符() {
        assert_eq!(
            to_wsl_path(r"C:\Users\foo\bar.sql"),
            "/mnt/c/Users/foo/bar.sql"
        );
        assert_eq!(to_wsl_path(r"D:/tmp/a.sql"), "/mnt/d/tmp/a.sql");
    }

    #[test]
    fn remap_schema_quoted_and_boundary() {
        let sql = r#"CREATE TABLE "app".t(id int); CREATE TABLE "app_dev".x(id int); SCHEMA app;"#;
        let out = remap_schema_in_sql(sql, "app", "v_factory");
        assert!(out.contains(r#""v_factory".t"#));
        assert!(out.contains(r#""app_dev".x"#));
        assert!(out.contains("SCHEMA v_factory"));
        assert!(!out.contains(r#""app".t"#));
    }

    #[test]
    fn resolve_bin_使用存在的手动目录() {
        let dir = std::env::temp_dir().join(format!(
            "qb_pg_tools_{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let exe = if cfg!(windows) { "psql.exe" } else { "psql" };
        fs::write(dir.join(exe), b"test").unwrap();
        let p = resolve_bin(&dir.to_string_lossy(), "psql");
        assert!(p.contains("psql"));
        assert!(p.contains("qb_pg_tools_"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn drop_schema_默认注释_可选_cascade() {
        let sql = "DROP SCHEMA ai_mail;\nDROP TABLE IF EXISTS ai_mail.t;\n";

        let (skipped, n) = adjust_drop_schema_statements(sql, "ai_mail", false);
        assert_eq!(n, 1);
        assert!(skipped.contains("-- [quickbar] 已跳过整库删除: DROP SCHEMA ai_mail;"));
        assert!(skipped.contains("DROP TABLE IF EXISTS ai_mail.t;"));

        let (cascade, n) = adjust_drop_schema_statements(sql, "ai_mail", true);
        assert_eq!(n, 1);
        assert!(cascade.contains("DROP SCHEMA IF EXISTS \"ai_mail\" CASCADE;"));

        // 已注释的行不再重复处理
        let (again, n) = adjust_drop_schema_statements(&skipped, "ai_mail", false);
        assert_eq!(n, 0);
        assert_eq!(again, skipped);
    }

    #[test]
    fn soften_create_schema_加_if_not_exists() {
        let sql = "CREATE SCHEMA ai_mail;\nCREATE SCHEMA IF NOT EXISTS other;\ncreate schema \"X\";\n";
        let (out, n) = soften_create_schema_statements(sql);
        assert_eq!(n, 2);
        assert!(out.contains("CREATE SCHEMA IF NOT EXISTS ai_mail;"));
        assert!(out.contains("CREATE SCHEMA IF NOT EXISTS other;"));
        assert!(out.contains("CREATE SCHEMA IF NOT EXISTS \"X\";"));
        assert!(!out.contains("CREATE SCHEMA IF NOT EXISTS IF NOT EXISTS"));
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_加解密往返() {
        let plain = br#"{"connections":[],"binDir":""}"#;
        let cipher = protect_bytes(plain).expect("protect");
        assert_ne!(cipher.as_slice(), plain);
        let back = unprotect_bytes(&cipher).expect("unprotect");
        assert_eq!(back.as_slice(), plain);
    }
}
