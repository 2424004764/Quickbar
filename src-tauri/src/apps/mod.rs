//! 本机应用索引：Windows 开始菜单 / 桌面快捷方式 / Linux .desktop
//! 中文名额外建立全拼 / 首字母，供搜索（如 jisuan → 计算器）

mod icon;

pub use icon::{
    ensure_icon_data_url, host_linux_do_icon_data_url, host_market_icon_data_url,
    host_settings_icon_data_url, host_v2ex_icon_data_url, windows_settings_icon_data_url,
};

use once_cell::sync::Lazy;
use parking_lot::RwLock;
use pinyin::ToPinyin;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    /// 全拼（无声调、小写），如 计算器 → jisuanqi
    #[serde(default)]
    pub pinyin: String,
    /// 拼音首字母，如 计算器 → jsq
    #[serde(default)]
    pub initials: String,
    /// 额外检索别名（英文名等）
    #[serde(default)]
    pub aliases: Vec<String>,
}

impl AppEntry {
    pub fn new(name: impl Into<String>, path: impl Into<String>) -> Self {
        let name = name.into();
        let path = path.into();
        let (pinyin, initials) = chinese_pinyin_keys(&name);
        Self {
            id: format!("app:{}", path),
            name,
            path,
            pinyin,
            initials,
            aliases: Vec::new(),
        }
    }

    pub fn with_aliases(mut self, aliases: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.aliases = aliases.into_iter().map(Into::into).collect();
        self
    }

    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = id.into();
        self
    }
}

/// 从中文名提取全拼与首字母；ASCII 字母数字按小写并入
pub fn chinese_pinyin_keys(name: &str) -> (String, String) {
    let mut full = String::new();
    let mut initials = String::new();
    for ch in name.chars() {
        if let Some(py) = ch.to_pinyin() {
            full.push_str(py.plain());
            initials.push_str(py.first_letter());
        } else if ch.is_ascii_alphanumeric() {
            let c = ch.to_ascii_lowercase();
            full.push(c);
            initials.push(c);
        }
    }
    (full, initials)
}

/// 对应用名 / 全拼 / 首字母 / 别名做匹配，取最高分。
/// 仅连续子串（不区分大小写），不做跳跃式 fuzzy。
pub fn score_app_query(app: &AppEntry, query: &str) -> Option<i64> {
    let q = query.trim();
    if q.is_empty() {
        return Some(1);
    }
    let q_lower = q.to_lowercase();
    let q_chars = q_lower.chars().count();
    let name_lower = app.name.to_lowercase();

    let mut haystacks: Vec<&str> = vec![
        name_lower.as_str(),
        app.pinyin.as_str(),
        app.initials.as_str(),
    ];
    let alias_owned: Vec<String> = app.aliases.iter().map(|a| a.to_lowercase()).collect();
    for a in &alias_owned {
        haystacks.push(a.as_str());
    }

    let mut best: Option<i64> = None;
    for hay in haystacks {
        if hay.is_empty() {
            continue;
        }
        // 全等 / 前缀 / 连续包含（均已小写，不区分大小写）
        if hay == q_lower {
            best = Some(best.map_or(200, |b| b.max(200)));
            continue;
        }
        if hay.starts_with(&q_lower) {
            let s = 120 + (q_chars as i64 * 4);
            best = Some(best.map_or(s, |b| b.max(s)));
        } else if hay.contains(&q_lower) {
            let s = 90 + (q_chars as i64 * 2);
            best = Some(best.map_or(s, |b| b.max(s)));
        }
    }
    best
}

static APP_CACHE: Lazy<RwLock<Vec<AppEntry>>> = Lazy::new(|| RwLock::new(Vec::new()));
static APP_CACHE_AT: Lazy<RwLock<Option<Instant>>> = Lazy::new(|| RwLock::new(None));

/// 重新扫描并缓存本机应用
pub fn refresh_apps() -> Vec<AppEntry> {
    let apps = scan_apps();
    *APP_CACHE.write() = apps.clone();
    *APP_CACHE_AT.write() = Some(Instant::now());
    apps
}

/// 缓存超过 max_age 则重扫（唤起后装软件也能搜到）
pub fn refresh_apps_if_stale(max_age: Duration) -> Vec<AppEntry> {
    let stale = APP_CACHE_AT
        .read()
        .map(|t| t.elapsed() > max_age)
        .unwrap_or(true);
    if stale || APP_CACHE.read().is_empty() {
        return refresh_apps();
    }
    cached_apps()
}

pub fn cached_apps() -> Vec<AppEntry> {
    let guard = APP_CACHE.read();
    if guard.is_empty() {
        drop(guard);
        return refresh_apps();
    }
    guard.clone()
}

fn scan_apps() -> Vec<AppEntry> {
    #[cfg(windows)]
    {
        let mut apps = scan_windows_start_menu();
        merge_builtin_windows_apps(&mut apps);
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        apps
    }
    #[cfg(not(windows))]
    {
        scan_linux_desktop_entries()
    }
}

/// Windows 计算器/记事本等为 UWP，开始菜单常无 .lnk；内置 System32 入口保证可搜
#[cfg(windows)]
fn merge_builtin_windows_apps(apps: &mut Vec<AppEntry>) {
    let mut seen_paths: std::collections::HashSet<String> =
        apps.iter().map(|a| a.path.to_ascii_lowercase()).collect();
    let mut seen_names: std::collections::HashSet<String> =
        apps.iter().map(|a| a.name.to_lowercase()).collect();

    for app in builtin_windows_apps() {
        let path_key = app.path.to_ascii_lowercase();
        let name_key = app.name.to_lowercase();
        if seen_paths.contains(&path_key) || seen_names.contains(&name_key) {
            continue;
        }
        seen_paths.insert(path_key);
        seen_names.insert(name_key);
        apps.push(app);
    }
}

#[cfg(windows)]
fn builtin_windows_apps() -> Vec<AppEntry> {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
    let sys32 = PathBuf::from(windir).join("System32");
    let builtins: &[(&str, &str, &[&str])] = &[
        ("计算器", "calc.exe", &["calculator", "calc", "windows calculator"]),
        ("记事本", "notepad.exe", &["notepad", "notepad.exe"]),
        ("画图", "mspaint.exe", &["paint", "mspaint"]),
        ("命令提示符", "cmd.exe", &["cmd", "command prompt"]),
        ("资源管理器", "explorer.exe", &["explorer", "file explorer"]),
    ];

    let mut out = Vec::new();
    for &(name, exe, aliases) in builtins {
        let path = sys32.join(exe);
        if !path.is_file() {
            continue;
        }
        out.push(
            AppEntry::new(name, path.to_string_lossy().to_string()).with_aliases(aliases.iter().copied()),
        );
    }
    out
}

#[cfg(windows)]
fn scan_windows_start_menu() -> Vec<AppEntry> {
    // (根目录, 最大深度)：开始菜单较深，桌面只扫一层
    let mut roots: Vec<(PathBuf, usize)> = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push((
            PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"),
            6,
        ));
    }
    if let Ok(program_data) = std::env::var("PROGRAMDATA") {
        roots.push((
            PathBuf::from(program_data).join(r"Microsoft\Windows\Start Menu\Programs"),
            6,
        ));
    }
    if let Some(desk) = dirs::desktop_dir() {
        roots.push((desk, 2));
    }
    if let Ok(public) = std::env::var("PUBLIC") {
        roots.push((PathBuf::from(public).join("Desktop"), 2));
    }

    let mut apps = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for (root, depth) in roots {
        collect_windows_launchables(&root, depth, &mut apps, &mut seen);
    }

    apps
}

/// 收集目录下 .lnk / .exe
#[cfg(windows)]
fn collect_windows_launchables(
    root: &Path,
    max_depth: usize,
    apps: &mut Vec<AppEntry>,
    seen: &mut std::collections::HashSet<String>,
) {
    if !root.exists() {
        return;
    }
    for entry in WalkDir::new(root).max_depth(max_depth).into_iter().flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "lnk" && ext != "exe" {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("app")
            .to_string();
        let full = path.to_string_lossy().to_string();
        if !seen.insert(full.clone()) {
            continue;
        }
        apps.push(AppEntry::new(name, full));
    }
}

#[cfg(not(windows))]
fn scan_linux_desktop_entries() -> Vec<AppEntry> {
    let mut roots = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".local/share/applications"));
    }

    let mut apps = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(&root).max_depth(3).into_iter().flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
                continue;
            }
            if let Some(app) = parse_desktop_entry(path) {
                if seen.insert(app.path.clone()) {
                    apps.push(app);
                }
            }
        }
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

#[cfg(not(windows))]
fn parse_desktop_entry(path: &Path) -> Option<AppEntry> {
    let raw = std::fs::read_to_string(path).ok()?;
    parse_desktop_entry_content(&raw, path)
}

/// 解析 .desktop 文本（Linux 扫描使用；Windows 上供单测）
#[cfg_attr(windows, allow(dead_code))]
pub fn parse_desktop_entry_content(raw: &str, path_for_id: &Path) -> Option<AppEntry> {
    let mut name = None;
    let mut exec = None;
    let mut no_display = false;
    let mut in_desktop = false;

    for line in raw.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_desktop = line == "[Desktop Entry]";
            continue;
        }
        if !in_desktop {
            continue;
        }
        if let Some(v) = line.strip_prefix("Name=") {
            if name.is_none() {
                name = Some(v.to_string());
            }
        } else if let Some(v) = line.strip_prefix("Exec=") {
            exec = Some(v.to_string());
        } else if line == "NoDisplay=true" || line == "Hidden=true" {
            no_display = true;
        }
    }

    if no_display {
        return None;
    }

    let name = name?;
    let exec = exec?;
    let cmd = exec
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches('"')
        .to_string();
    if cmd.is_empty() {
        return None;
    }

    let mut app = AppEntry::new(name, cmd);
    // id 仍用 .desktop 路径，便于区分
    app.id = format!("app:{}", path_for_id.display());
    Some(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 解析桌面快捷方式_正常条目() {
        let raw = "[Desktop Entry]\nName=Demo App\nExec=/usr/bin/demo %U\nType=Application\n";
        let app = parse_desktop_entry_content(raw, Path::new("/tmp/demo.desktop")).unwrap();
        assert_eq!(app.name, "Demo App");
        assert_eq!(app.path, "/usr/bin/demo");
        assert!(app.id.contains("demo.desktop"));
    }

    #[test]
    fn 解析桌面快捷方式_隐藏条目应跳过() {
        let raw = "[Desktop Entry]\nName=Hidden\nExec=/bin/true\nNoDisplay=true\n";
        assert!(parse_desktop_entry_content(raw, Path::new("h.desktop")).is_none());
    }

    #[test]
    fn 中文名生成全拼与首字母() {
        let (full, initials) = chinese_pinyin_keys("计算器");
        assert_eq!(full, "jisuanqi");
        assert_eq!(initials, "jsq");

        let (full2, initials2) = chinese_pinyin_keys("记事本");
        assert_eq!(full2, "jishiben");
        assert_eq!(initials2, "jsb");
    }

    /// 目的：拼音 / 中文前缀 / 首字母可命中中文应用名
    /// 运行：cd src-tauri && cargo test 拼音搜索命中计算器与记事本 -- --nocapture
    #[test]
    fn 拼音搜索命中计算器与记事本() {
        let calc = AppEntry::new("计算器", "C:\\calc.lnk")
            .with_aliases(["calculator", "calc"]);
        let note = AppEntry::new("记事本", "C:\\notepad.lnk");

        assert!(score_app_query(&calc, "jisuan").is_some());
        assert!(score_app_query(&calc, "jsq").is_some());
        assert!(score_app_query(&calc, "计算").is_some());
        assert!(score_app_query(&calc, "计算器").is_some());
        assert!(score_app_query(&calc, "calc").is_some());
        assert!(score_app_query(&note, "jishi").is_some());
        assert!(score_app_query(&note, "jsb").is_some());

        // jisuan 应对计算器分更高，避免误伤记事本
        let s_calc = score_app_query(&calc, "jisuan").unwrap();
        let s_note = score_app_query(&note, "jisuan");
        assert!(
            s_note.is_none() || s_calc > s_note.unwrap(),
            "jisuan 应优先计算器: calc={s_calc} note={s_note:?}"
        );

        let s_prefix = score_app_query(&calc, "计算").unwrap();
        assert!(s_prefix >= 120, "中文前缀应高分: {s_prefix}");
    }

    /// 目的：只认连续子串，不区分大小写；禁止 B-a-s-e 跳跃命中 ODBC
    /// 运行：cd src-tauri && cargo test 连续子串匹配不误伤 -- --nocapture
    #[test]
    fn 连续子串匹配不误伤() {
        let tim = AppEntry::new("TIM", r"C:\ProgramData\...\TIM.lnk");
        let navicat = AppEntry::new("Navicat Premium Lite 17", r"C:\...\Navicat.lnk");
        let vs = AppEntry::new(
            "x86 Native Tools Command Prompt for VS 2022",
            r"C:\...\vs.lnk",
        );
        let odbc = AppEntry::new(
            "ODBC Data Sources (32-bit)",
            r"C:\...\odbcad32.lnk",
        );
        let base64 = AppEntry::new("Base64 编解码", r"plugin:base64");

        assert_eq!(score_app_query(&tim, "tim"), Some(200));
        assert_eq!(score_app_query(&tim, "TIM"), Some(200));
        assert!(score_app_query(&navicat, "tim").is_none());
        assert!(score_app_query(&vs, "tim").is_none());
        assert!(score_app_query(&odbc, "base").is_none());
        assert!(score_app_query(&base64, "base").is_some());
        assert!(score_app_query(&base64, "BASE").is_some());
    }
}
