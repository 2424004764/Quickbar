//! 前端可调用的 Tauri commands

use crate::apps::{
    cached_apps, ensure_icon_data_url, host_linux_do_icon_data_url, host_market_icon_data_url,
    host_settings_icon_data_url, host_v2ex_icon_data_url, refresh_apps, refresh_apps_if_stale,
    score_app_query, windows_settings_icon_data_url, AppEntry,
};
use std::time::Duration;
use crate::config::{
    ensure_data_dirs, load_config, market_dir, plugins_dir, save_config, AppConfig, CustomApp,
    UserCommand,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use crate::plugin::{load_all_plugins, plugin_search_hints, user_command_items, LoadedPlugin};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub kind: String,
    pub action: String,
    pub payload: String,
    pub score: i32,
    /// 应用图标 data URL（data:image/png;base64,...），非应用可为空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketItem {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub category: String,
    /// local:packages/... 或 https://.../xxx.zip
    pub source: String,
    pub installed: bool,
    pub installed_version: Option<String>,
    /// 云端下载地址（可选；缺省用 source）
    #[serde(default)]
    pub download_url: Option<String>,
}

pub struct AppState {
    pub resource_dir: parking_lot::RwLock<Option<PathBuf>>,
    /// 为 false 时（如市场页/系统对话框）不因失焦自动隐藏
    pub allow_blur_hide: parking_lot::RwLock<bool>,
}

#[tauri::command]
pub fn get_config() -> AppConfig {
    let _ = ensure_data_dirs();
    load_config()
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<(), String> {
    save_config(&config)
}

/// 更新界面主题：dark / light / system
#[tauri::command]
pub fn set_theme(theme: String) -> Result<AppConfig, String> {
    let normalized = match theme.trim().to_ascii_lowercase().as_str() {
        "dark" | "light" | "system" => theme.trim().to_ascii_lowercase(),
        _ => {
            return Err("theme 须为 dark、light 或 system".to_string());
        }
    };
    let mut config = load_config();
    config.theme = normalized;
    save_config(&config)?;
    Ok(config)
}

#[tauri::command]
pub fn refresh_app_index() -> Vec<AppEntry> {
    refresh_apps()
}

/// 按路径取应用图标 data URL（走磁盘缓存；首页最近使用等复用）
#[tauri::command]
pub fn get_app_icon(path: String) -> Option<String> {
    let p = path.trim();
    if p.is_empty() {
        return None;
    }
    let _ = ensure_data_dirs();
    ensure_icon_data_url(p)
}

#[tauri::command]
pub fn list_plugins(state: State<AppState>) -> Vec<LoadedPlugin> {
    let dir = state.resource_dir.read().clone();
    load_all_plugins(dir)
}

#[tauri::command]
pub fn search(query: String, state: State<AppState>) -> Vec<SearchItem> {
    let _ = ensure_data_dirs();
    let config = load_config();
    let resource_dir = state.resource_dir.read().clone();
    let plugins = load_all_plugins(resource_dir);
    let q = query.trim();

    // 非空查询时若索引偏旧则重扫，避免刚装软件搜不到
    let apps = if q.is_empty() {
        cached_apps()
    } else {
        refresh_apps_if_stale(Duration::from_secs(20))
    };

    let mut items: Vec<SearchItem> = Vec::new();

    // 本机应用（中文名同时匹配全拼 / 首字母）
    for app in apps {
        if let Some(s) = score_app_query(&app, q) {
            items.push(SearchItem {
                id: app.id.clone(),
                title: app.name.clone(),
                subtitle: app.path.clone(),
                kind: "app".to_string(),
                action: "open_path".to_string(),
                payload: app.path.clone(),
                score: s as i32,
                icon_data_url: None,
            });
        }
    }

    // 用户「本地启动」
    for app in custom_apps_as_entries(&config) {
        if let Some(s) = score_app_query(&app, q) {
            items.push(SearchItem {
                id: app.id.clone(),
                title: app.name.clone(),
                subtitle: app.path.clone(),
                kind: "app".to_string(),
                action: "open_path".to_string(),
                payload: app.path.clone(),
                score: s as i32 + 5,
                icon_data_url: None,
            });
        }
    }

    // 粘贴了可启动路径：提供「加入本地启动」
    if let Some(path) = normalize_launchable_path(q) {
        let path_str = path.to_string_lossy().to_string();
        let already = config
            .custom_apps
            .iter()
            .any(|a| paths_equal(&a.path, &path_str))
            || cached_apps()
                .iter()
                .any(|a| paths_equal(&a.path, &path_str));
        let icon = ensure_icon_data_url(&path_str);
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("应用")
            .to_string();
        if !already {
            items.push(SearchItem {
                id: format!("action:add-local:{}", custom_app_id(&path_str)),
                title: "加入「本地启动」".into(),
                subtitle: path_str.clone(),
                kind: "action".into(),
                action: "add_custom_app".into(),
                payload: path_str.clone(),
                score: 10_000,
                icon_data_url: icon.clone(),
            });
        }
        // 也可直接打开该文件
        if !items.iter().any(|i| i.action == "open_path" && paths_equal(&i.payload, &path_str))
        {
            items.push(SearchItem {
                id: format!("app:open:{}", custom_app_id(&path_str)),
                title: name,
                subtitle: path_str.clone(),
                kind: "app".into(),
                action: "open_path".into(),
                payload: path_str,
                score: 9_500,
                icon_data_url: icon,
            });
        }
    }

    items.extend(user_command_items(&config, q));
    items.extend(plugin_search_hints(&plugins, q));
    // 宿主导航：设置 / 应用市场等（页脚入口也要能搜到）
    items.extend(host_nav_items(q));

    let mut items = finalize_search_items(items, q.is_empty());
    // 仅给最终展示的应用补图标（空查询首页不拉，避免过慢）
    if !q.is_empty() {
        for item in &mut items {
            if item.icon_data_url.is_some() {
                continue;
            }
            if item.kind == "app" || item.payload.starts_with("ms-settings:") {
                item.icon_data_url = ensure_icon_data_url(&item.payload);
            }
        }
    }
    items
}

/// Quickbar 内置导航（设置、市场、网页入口）及 Windows 系统设置
fn host_nav_items(query: &str) -> Vec<SearchItem> {
    let q = query.trim();
    if q.is_empty() {
        return Vec::new();
    }

    let catalog: Vec<(AppEntry, &str, &str, &str, i32)> = vec![
        (
            AppEntry::new("设置", "host:settings").with_aliases([
                "settings",
                "setting",
                "config",
                "配置",
                "偏好",
            ]),
            "open_settings",
            "settings",
            "Quickbar 配置：热键、命令等",
            20,
        ),
        (
            AppEntry::new("应用市场", "host:market").with_aliases([
                "市场",
                "market",
                "插件市场",
                "plugin market",
            ]),
            "open_market",
            "market",
            "免费应用可添加，数量无限制",
            15,
        ),
        (
            AppEntry::new("LINUX DO", "host:linux-do").with_aliases([
                "linux.do",
                "linuxdo",
                "linux do",
                "LDO",
            ]),
            "open_path",
            "https://linux.do/",
            "打开 LINUX DO 社区",
            12,
        ),
        (
            AppEntry::new("V2EX", "host:v2ex").with_aliases([
                "v2ex.com",
                "v2",
                "酷客",
            ]),
            "open_path",
            "https://www.v2ex.com/",
            "打开 V2EX",
            12,
        ),
        (
            AppEntry::new("Windows 设置", "ms-settings:").with_aliases([
                "系统设置",
                "控制面板",
                "windows settings",
            ]),
            "open_path",
            "ms-settings:",
            "打开系统设置",
            5,
        ),
    ];

    let win_settings_icon = windows_settings_icon_data_url();
    let qb_settings_icon = Some(host_settings_icon_data_url());
    let market_icon = Some(host_market_icon_data_url());
    let linux_do_icon = Some(host_linux_do_icon_data_url());
    let v2ex_icon = Some(host_v2ex_icon_data_url());

    let mut items = Vec::new();
    for (app, action, payload, subtitle, bonus) in catalog {
        if let Some(s) = score_app_query(&app, q) {
            let icon_data_url = match (action, payload) {
                ("open_settings", _) => qb_settings_icon.clone(),
                ("open_market", _) => market_icon.clone(),
                ("open_path", p) if p.starts_with("ms-settings:") => win_settings_icon.clone(),
                ("open_path", "https://linux.do/") => linux_do_icon.clone(),
                ("open_path", "https://www.v2ex.com/") => v2ex_icon.clone(),
                _ => None,
            };
            items.push(SearchItem {
                id: format!("host:{}", app.id),
                title: app.name,
                subtitle: subtitle.into(),
                kind: if action == "open_path" {
                    "app".into()
                } else {
                    "action".into()
                },
                action: action.into(),
                payload: payload.into(),
                score: s as i32 + bonus,
                icon_data_url,
            });
        }
    }
    items
}

/// 从候选路径中取第一个可启动项（.exe/.lnk 且文件存在）
pub fn first_launchable_from_candidates<'a, I>(candidates: I) -> Option<String>
where
    I: IntoIterator<Item = &'a str>,
{
    for c in candidates {
        if let Some(p) = normalize_launchable_path(c) {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

/// 读取系统剪贴板中的可启动路径（优先资源管理器文件列表，其次文本）
#[tauri::command]
pub fn read_clipboard_launchable_path() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        use clipboard_win::{formats, get_clipboard};

        if let Ok(files) = get_clipboard::<Vec<String>, _>(formats::FileList) {
            if let Some(p) = first_launchable_from_candidates(files.iter().map(|s| s.as_str())) {
                return Ok(Some(p));
            }
        }
        if let Ok(text) = get_clipboard::<String, _>(formats::Unicode) {
            if let Some(p) = first_launchable_from_candidates(std::iter::once(text.as_str())) {
                return Ok(Some(p));
            }
        }
        Ok(None)
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

/// 规范化剪贴板/搜索框中的可启动路径（.exe / .lnk）
pub fn normalize_launchable_path(raw: &str) -> Option<PathBuf> {
    let mut s = raw.trim();
    if s.is_empty() {
        return None;
    }
    // 去掉成对引号
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        s = &s[1..s.len() - 1];
        s = s.trim();
    }
    let s = s
        .strip_prefix("file:///")
        .or_else(|| s.strip_prefix("file://"))
        .unwrap_or(s);
    // 简单解码常见空白
    let decoded = s.replace("%20", " ").replace("%5C", "\\").replace("%5c", "\\");
    let path = PathBuf::from(decoded.trim());
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "exe" && ext != "lnk" {
        return None;
    }
    if !path.is_file() {
        return None;
    }
    Some(path)
}

fn custom_app_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.to_ascii_lowercase().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn paths_equal(a: &str, b: &str) -> bool {
    a.replace('/', "\\").eq_ignore_ascii_case(&b.replace('/', "\\"))
}

fn custom_apps_as_entries(config: &AppConfig) -> Vec<AppEntry> {
    config
        .custom_apps
        .iter()
        .map(|c| {
            let mut aliases = c.aliases.clone();
            if c.resolved_kind() == "web" {
                aliases.push(c.path.clone());
                aliases.push("网页".into());
                aliases.push("web".into());
            }
            AppEntry::new(c.name.clone(), c.path.clone())
                .with_aliases(aliases)
                .with_id(format!("local:{}", c.id))
        })
        .collect()
}

/// 将 exe/lnk 加入本地启动
#[tauri::command]
pub fn add_custom_app(path: String, name: Option<String>) -> Result<CustomApp, String> {
    let _ = ensure_data_dirs();
    let path_buf = normalize_launchable_path(&path)
        .ok_or_else(|| "请粘贴有效的 .exe 或 .lnk 文件路径".to_string())?;
    let path_str = path_buf.to_string_lossy().to_string();
    let display_name = name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            path_buf
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("应用")
                .to_string()
        });

    let mut config = load_config();
    if let Some(existing) = config
        .custom_apps
        .iter()
        .find(|a| paths_equal(&a.path, &path_str))
    {
        return Ok(existing.clone());
    }

    let app = CustomApp {
        id: custom_app_id(&path_str),
        name: display_name,
        path: path_str,
        aliases: vec![],
        kind: "native".into(),
        description: String::new(),
        share_to_market: false,
        market_status: "local".into(),
        market_remote_id: String::new(),
        market_message: String::new(),
    };
    config.custom_apps.push(app.clone());
    save_config(&config)?;
    // 预热图标缓存
    let _ = ensure_icon_data_url(&app.path);
    Ok(app)
}

#[tauri::command]
pub fn remove_custom_app(id: String) -> Result<(), String> {
    let mut config = load_config();
    let before = config.custom_apps.len();
    config.custom_apps.retain(|a| a.id != id);
    if config.custom_apps.len() == before {
        return Err(format!("本地启动项不存在: {id}"));
    }
    save_config(&config)
}

#[tauri::command]
pub fn list_custom_apps() -> Vec<CustomApp> {
    load_config().custom_apps
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertWebAppRequest {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// true = 尝试同步到云端市场；false = 仅本机自用
    #[serde(default)]
    pub share_to_market: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertWebAppResult {
    pub app: CustomApp,
    /// 给人看的同步结果说明
    pub sync_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCustomAppResult {
    pub app: CustomApp,
    pub synced: bool,
    pub message: String,
}

/// 创建 / 更新网页应用；可选同步到云端市场（未配置基址则本地留 pending）
#[tauri::command]
pub fn upsert_web_app(req: UpsertWebAppRequest) -> Result<UpsertWebAppResult, String> {
    let _ = ensure_data_dirs();
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err("请填写应用名称".into());
    }
    let url = normalize_web_url(&req.url)?;
    let description = req.description.trim().to_string();
    let aliases: Vec<String> = req
        .aliases
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let mut config = load_config();
    let id = if !req.id.trim().is_empty() {
        req.id.trim().to_string()
    } else {
        custom_app_id(&url)
    };

    let existing_idx = config.custom_apps.iter().position(|a| a.id == id);
    let mut app = if let Some(i) = existing_idx {
        config.custom_apps[i].clone()
    } else if let Some(dup) = config
        .custom_apps
        .iter()
        .find(|a| a.resolved_kind() == "web" && paths_equal(&a.path, &url))
    {
        dup.clone()
    } else {
        CustomApp {
            id: id.clone(),
            name: name.clone(),
            path: url.clone(),
            aliases: aliases.clone(),
            kind: "web".into(),
            description: description.clone(),
            share_to_market: req.share_to_market,
            market_status: "local".into(),
            market_remote_id: String::new(),
            market_message: String::new(),
        }
    };

    app.name = name;
    app.path = url;
    app.kind = "web".into();
    app.description = description;
    app.aliases = aliases;
    app.share_to_market = req.share_to_market;

    let sync_message = if req.share_to_market {
        match try_sync_custom_app_to_market(&mut app) {
            Ok(msg) => msg,
            Err(e) => {
                app.market_status = "error".into();
                app.market_message = e.clone();
                format!("已保存到本机，同步失败：{e}")
            }
        }
    } else {
        app.market_status = "local".into();
        app.market_remote_id.clear();
        app.market_message = "仅本机自用".into();
        "已保存为仅本机自用".into()
    };

    if let Some(i) = config.custom_apps.iter().position(|a| a.id == app.id) {
        config.custom_apps[i] = app.clone();
    } else {
        config.custom_apps.push(app.clone());
    }
    save_config(&config)?;
    Ok(UpsertWebAppResult { app, sync_message })
}

/// 把本机自定义应用（网页 / 原生）同步到云端市场（预留口子）
#[tauri::command]
pub fn sync_custom_app_to_market(id: String) -> Result<SyncCustomAppResult, String> {
    let _ = ensure_data_dirs();
    let mut config = load_config();
    let idx = config
        .custom_apps
        .iter()
        .position(|a| a.id == id)
        .ok_or_else(|| format!("本地应用不存在: {id}"))?;
    let mut app = config.custom_apps[idx].clone();
    app.share_to_market = true;
    let message = match try_sync_custom_app_to_market(&mut app) {
        Ok(msg) => {
            let synced = app.market_status == "queued" || app.market_status == "published";
            config.custom_apps[idx] = app.clone();
            save_config(&config)?;
            return Ok(SyncCustomAppResult {
                app,
                synced,
                message: msg,
            });
        }
        Err(e) => {
            app.market_status = if load_config().market_base_url.trim().is_empty() {
                "pending".into()
            } else {
                "error".into()
            };
            app.market_message = e.clone();
            config.custom_apps[idx] = app.clone();
            save_config(&config)?;
            e
        }
    };
    Ok(SyncCustomAppResult {
        synced: false,
        app: config.custom_apps[idx].clone(),
        message,
    })
}

/// 设置云端市场基址（空 = 仅用本地市场）
#[tauri::command]
pub fn set_market_base_url(url: String) -> Result<AppConfig, String> {
    let mut config = load_config();
    config.market_base_url = url.trim().trim_end_matches('/').to_string();
    save_config(&config)?;
    Ok(config)
}

fn normalize_web_url(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("请填写网页地址".into());
    }
    let url = if s.starts_with("http://") || s.starts_with("https://") {
        s.to_string()
    } else {
        format!("https://{s}")
    };
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url.as_str());
    if rest.is_empty() || !rest.contains('.') && !rest.starts_with("localhost") {
        return Err("网页地址看起来无效，请包含域名（如 example.com）".into());
    }
    Ok(url)
}

/// 向云端投稿自定义应用。协议：POST {base}/market/submit-app
/// 无基址时标记 pending，不报错（方便以后开通市场）。
fn try_sync_custom_app_to_market(app: &mut CustomApp) -> Result<String, String> {
    let config = load_config();
    let base = config.market_base_url.trim();
    if base.is_empty() {
        app.market_status = "pending".into();
        app.market_message =
            "已标记待同步：尚未配置 marketBaseUrl，开通云端市场后可一键推送".into();
        return Ok(app.market_message.clone());
    }

    let kind = app.resolved_kind().to_string();
    let body = serde_json::json!({
        "kind": kind,
        "id": app.id,
        "name": app.name,
        "url": if kind == "web" { app.path.clone() } else { String::new() },
        "path": if kind == "native" { app.path.clone() } else { String::new() },
        "description": app.description,
        "aliases": app.aliases,
        "version": "0.1.0",
        "category": if kind == "web" { "web" } else { "app" },
    });

    let url = format!("{}/market/submit-app", base.trim_end_matches('/'));
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| format!("连接云端市场失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().unwrap_or_default();
    if status.as_u16() == 404 {
        app.market_status = "unavailable".into();
        app.market_message =
            "云端尚未实现 /market/submit-app，本地已保留待同步标记".into();
        return Ok(app.market_message.clone());
    }
    if !status.is_success() {
        return Err(format!("同步失败 HTTP {status}: {text}"));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({ "message": text }));
    let remote_id = parsed
        .get("submissionId")
        .or_else(|| parsed.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let remote_status = parsed
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("queued");
    app.market_remote_id = remote_id.clone();
    app.market_status = if remote_status == "published" {
        "published".into()
    } else {
        "queued".into()
    };
    app.market_message = parsed
        .get("message")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if remote_id.is_empty() {
                format!("已提交云端（{remote_status}）")
            } else {
                format!("已提交云端（{remote_status}，单号 {remote_id}）")
            }
        });
    Ok(app.market_message.clone())
}

/// 合并搜索结果：空查询裁剪应用数量，非空截断总数
pub fn finalize_search_items(mut items: Vec<SearchItem>, query_empty: bool) -> Vec<SearchItem> {
    items.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.title.cmp(&b.title)));
    if query_empty {
        let mut apps: Vec<_> = items.iter().filter(|i| i.kind == "app").cloned().collect();
        let mut others: Vec<_> = items.into_iter().filter(|i| i.kind != "app").collect();
        apps.truncate(12);
        others.extend(apps);
        return others;
    }
    items.truncate(40);
    items
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    ::open::that(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_user_command(command_id: String) -> Result<(), String> {
    let config = load_config();
    let cmd = config
        .commands
        .iter()
        .find(|c| c.id == command_id)
        .ok_or_else(|| format!("命令不存在: {}", command_id))?;
    run_command_line(&cmd.command, &cmd.args)
}

#[tauri::command]
pub fn run_shell_command(command: String, args: Vec<String>) -> Result<(), String> {
    run_command_line(&command, &args)
}

fn run_command_line(command: &str, args: &[String]) -> Result<(), String> {
    #[cfg(windows)]
    {
        StdCommand::new(command)
            .args(args)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        // Linux：若 command 含空格且无 args，走 sh -c
        if args.is_empty() && command.contains(' ') {
            StdCommand::new("sh")
                .arg("-c")
                .arg(command)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            StdCommand::new(command)
                .args(args)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), String> {
    // 用 webview 取窗口：主窗挂了内嵌网页后 get_webview_window 会返回 None
    if let Some(win) = app.get_webview("main").map(|wv| wv.window()) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    crate::show_launcher(&app)
}

#[tauri::command]
pub fn list_market(state: State<AppState>) -> Result<Vec<MarketItem>, String> {
    list_market_items(&state)
}

fn list_market_items(state: &State<AppState>) -> Result<Vec<MarketItem>, String> {
    let _ = ensure_data_dirs();
    let config = load_config();
    let base = config.market_base_url.trim();
    let mut items = if !base.is_empty() {
        match fetch_remote_catalog(base) {
            Ok(remote) => remote,
            Err(err) => {
                eprintln!("云端市场不可用，回退本地: {err}");
                load_local_catalog(state)?
            }
        }
    } else {
        load_local_catalog(state)?
    };
    annotate_installed(&mut items, state);
    Ok(items)
}

fn annotate_installed(items: &mut [MarketItem], state: &State<AppState>) {
    let installed = load_all_plugins(state.resource_dir.read().clone());
    for item in items.iter_mut() {
        if let Some(p) = installed.iter().find(|p| p.manifest.id == item.id) {
            item.installed = true;
            item.installed_version = Some(p.manifest.version.clone());
        } else {
            item.installed = false;
            item.installed_version = None;
        }
    }
}

fn load_local_catalog(state: &State<AppState>) -> Result<Vec<MarketItem>, String> {
    let catalog_path = resolve_catalog_path(state)?;
    let raw = fs::read_to_string(&catalog_path)
        .map_err(|e| format!("读取市场目录失败 {}: {}", catalog_path.display(), e))?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn fetch_remote_catalog(base: &str) -> Result<Vec<MarketItem>, String> {
    let url = format!("{}/market/catalog", base.trim_end_matches('/'));
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("云端 catalog HTTP {}", resp.status()));
    }
    let mut items: Vec<MarketItem> = resp.json().map_err(|e| e.to_string())?;
    for item in &mut items {
        if item.source.is_empty() {
            if let Some(u) = item.download_url.clone() {
                item.source = u;
            }
        }
    }
    Ok(items)
}

fn download_url_to_temp(url: &str) -> Result<PathBuf, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("下载失败 HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    let dir = std::env::temp_dir().join("quickbar-market-dl");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!(
        "pkg_{}.zip",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

fn is_http_url(s: &str) -> bool {
    let t = s.trim().to_ascii_lowercase();
    t.starts_with("http://") || t.starts_with("https://")
}

/// 查找仓库/资源目录中的种子 catalog（开发态优先 cwd）
fn find_seed_market_catalog(state: &State<AppState>) -> Option<PathBuf> {
    let config = load_config();
    let rel = PathBuf::from(&config.market_catalog);

    if let Ok(cwd) = std::env::current_dir() {
        for base in [cwd.clone(), cwd.join("..")] {
            let c = base.join("market").join("catalog.json");
            if c.exists() {
                return Some(c);
            }
        }
    }

    if let Some(res) = state.resource_dir.read().clone() {
        // Tauri 2 对 resources 里的 `../xxx` 会落到 `$RESOURCE/_up_/xxx`
        for c in [
            res.join(&rel),
            res.join("market").join("catalog.json"),
            res.join("_up_").join("market").join("catalog.json"),
            res.join("catalog.json"),
        ] {
            if c.exists() {
                return Some(c);
            }
        }
    }
    None
}

/// 把种子市场里「用户目录尚无」的条目与包合并进去（升级后能看到新工具）
fn sync_seed_market_into_user(state: &State<AppState>) {
    let Some(seed_catalog) = find_seed_market_catalog(state) else {
        return;
    };
    let user_catalog = market_dir().join("catalog.json");
    let _ = fs::create_dir_all(market_dir());

    let Ok(seed_raw) = fs::read_to_string(&seed_catalog) else {
        return;
    };
    let Ok(seed_items) = serde_json::from_str::<Vec<MarketItem>>(&seed_raw) else {
        return;
    };

    let mut user_items = if user_catalog.exists() {
        fs::read_to_string(&user_catalog)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<MarketItem>>(&raw).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let existing: std::collections::HashSet<String> =
        user_items.iter().map(|i| i.id.clone()).collect();
    let mut added = 0usize;
    for item in seed_items {
        if existing.contains(&item.id) {
            continue;
        }
        user_items.push(item);
        added += 1;
    }
    if added > 0 || !user_catalog.exists() {
        if let Ok(next) = serde_json::to_string_pretty(&user_items) {
            let _ = fs::write(&user_catalog, next);
        }
    }

    // 同步缺失的 packages/<id>
    if let Some(seed_root) = seed_catalog.parent() {
        let seed_packages = seed_root.join("packages");
        let user_packages = market_dir().join("packages");
        if seed_packages.is_dir() {
            let _ = fs::create_dir_all(&user_packages);
            if let Ok(entries) = fs::read_dir(&seed_packages) {
                for entry in entries.flatten() {
                    let src = entry.path();
                    if !src.is_dir() {
                        continue;
                    }
                    let name = entry.file_name();
                    let dst = user_packages.join(&name);
                    if !dst.exists() {
                        let _ = copy_dir_all(&src, &dst);
                    }
                }
            }
        }
    }
}

fn resolve_catalog_path(state: &State<AppState>) -> Result<PathBuf, String> {
    let user_catalog = market_dir().join("catalog.json");

    // 已有用户 catalog：合并种子市场中的新条目（不覆盖已有项）
    if user_catalog.exists() {
        sync_seed_market_into_user(state);
        return Ok(user_catalog);
    }

    // 首次：从种子整份复制
    if let Some(seed) = find_seed_market_catalog(state) {
        let _ = fs::create_dir_all(market_dir());
        let _ = fs::copy(&seed, &user_catalog);
        if let Some(parent) = seed.parent() {
            let packages = parent.join("packages");
            if packages.exists() {
                let _ = copy_dir_all(&packages, &market_dir().join("packages"));
            }
        }
        if user_catalog.exists() {
            return Ok(user_catalog);
        }
        return Ok(seed);
    }

    Err("未找到 market/catalog.json，请将目录放到 ~/.quickbar/market/".into())
}

#[tauri::command]
pub fn install_plugin_from_path(path: String, state: State<AppState>) -> Result<LoadedPlugin, String> {
    let _ = ensure_data_dirs();
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    let dest_root = plugins_dir();
    fs::create_dir_all(&dest_root).map_err(|e| e.to_string())?;

    let installed_root = if src.is_file()
        && src
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("zip"))
            .unwrap_or(false)
    {
        extract_zip_plugin(&src, &dest_root)?
    } else if src.is_dir() {
        copy_plugin_dir(&src, &dest_root)?
    } else {
        return Err("请选择插件目录或 .zip 包".into());
    };

    let manifest_path = installed_root.join("plugin.json");
    let raw = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let manifest = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let _ = state;
    Ok(LoadedPlugin {
        manifest,
        root: installed_root.to_string_lossy().to_string(),
        builtin: false,
    })
}

#[tauri::command]
pub fn set_blur_hide_enabled(enabled: bool, state: State<AppState>) -> Result<(), String> {
    *state.allow_blur_hide.write() = enabled;
    Ok(())
}

#[tauri::command]
pub fn install_market_item(item_id: String, state: State<AppState>) -> Result<LoadedPlugin, String> {
    let items = list_market_items(&state)?;
    let item = items
        .iter()
        .find(|i| i.id == item_id)
        .ok_or_else(|| format!("市场项不存在: {}", item_id))?
        .clone();

    let url = item
        .download_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(item.source.as_str());

    let source_path = if is_http_url(url) {
        download_url_to_temp(url)?
    } else {
        resolve_market_source(&item.source, &state)?
    };
    install_plugin_from_path(source_path.to_string_lossy().to_string(), state)
}

/// 投稿插件 zip 到云端市场（待审核）
#[tauri::command]
pub fn submit_market_plugin(
    path: String,
    author: Option<String>,
) -> Result<serde_json::Value, String> {
    let config = load_config();
    let base = config.market_base_url.trim();
    if base.is_empty() {
        return Err("未配置 marketBaseUrl，无法投稿。请在 ~/.quickbar/config.json 设置。".into());
    }
    let file_path = PathBuf::from(&path);
    if !file_path.is_file() {
        return Err("请选择 .zip 插件包".into());
    }
    let url = format!("{}/market/submit", base.trim_end_matches('/'));
    let mut form = reqwest::blocking::multipart::Form::new()
        .file("file", &file_path)
        .map_err(|e| format!("读取 zip 失败: {e}"))?;
    if let Some(a) = author.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        form = form.text("author", a);
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("投稿失败 HTTP {status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {e}; body={body}"))
}

fn resolve_market_source(source: &str, state: &State<AppState>) -> Result<PathBuf, String> {
    if let Some(rel) = source.strip_prefix("local:") {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let res = state.resource_dir.read().clone();
        let candidates =
            local_market_path_candidates(rel, &market_dir(), res.as_deref(), &cwd);
        for c in candidates {
            if c.exists() {
                return Ok(c);
            }
        }
        return Err(format!("找不到市场包: {}", source));
    }

    let p = PathBuf::from(source);
    if p.exists() {
        return Ok(p);
    }
    Err(format!("无效 source: {}", source))
}

/// local: 市场包候选路径（纯拼装，便于单测）
pub fn local_market_path_candidates(
    rel: &str,
    market_home: &Path,
    resource_dir: Option<&Path>,
    cwd: &Path,
) -> Vec<PathBuf> {
    let mut v = Vec::new();
    v.push(market_home.join(rel));
    if let Some(res) = resource_dir {
        v.push(res.join("market").join(rel));
        v.push(res.join("_up_").join("market").join(rel));
        v.push(res.join(rel));
    }
    v.push(cwd.join("market").join(rel));
    v.push(cwd.join("../market").join(rel));
    v
}

fn copy_plugin_dir(src: &Path, dest_root: &Path) -> Result<PathBuf, String> {
    let manifest_path = src.join("plugin.json");
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("缺少 plugin.json: {}", e))?;
    let manifest: crate::plugin::PluginManifest =
        serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let dest = dest_root.join(&manifest.id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    copy_dir_all(src, &dest)?;
    Ok(dest)
}

fn extract_zip_plugin(zip_path: &Path, dest_root: &Path) -> Result<PathBuf, String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    // 解压到临时目录再识别 plugin.json
    let tmp = dest_root.join(format!(".tmp_{}", std::process::id()));
    if tmp.exists() {
        fs::remove_dir_all(&tmp).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(p) => tmp.join(p),
            None => continue,
        };
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            outfile.write_all(&buf).map_err(|e| e.to_string())?;
        }
    }

    // 找到 plugin.json
    let mut manifest_file = None;
    for entry in WalkDir::new(&tmp).into_iter().flatten() {
        if entry.file_name() == "plugin.json" {
            manifest_file = Some(entry.path().to_path_buf());
            break;
        }
    }
    let manifest_path = manifest_file.ok_or_else(|| "zip 内未找到 plugin.json".to_string())?;
    let plugin_src = manifest_path
        .parent()
        .ok_or_else(|| "无效插件包".to_string())?
        .to_path_buf();
    let dest = copy_plugin_dir(&plugin_src, dest_root)?;
    let _ = fs::remove_dir_all(&tmp);
    Ok(dest)
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in WalkDir::new(src).into_iter().flatten() {
        let path = entry.path();
        let rel = path.strip_prefix(src).map_err(|e| e.to_string())?;
        let target = dst.join(rel);
        if path.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else if path.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(path, &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn uninstall_plugin(plugin_id: String) -> Result<(), String> {
    let dest = plugins_dir().join(&plugin_id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn add_user_command(command: UserCommand) -> Result<AppConfig, String> {
    let mut config = load_config();
    if config.commands.iter().any(|c| c.id == command.id) {
        return Err(format!("命令 id 已存在: {}", command.id));
    }
    config.commands.push(command);
    save_config(&config)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(kind: &str, title: &str, score: i32) -> SearchItem {
        SearchItem {
            id: title.into(),
            title: title.into(),
            subtitle: String::new(),
            kind: kind.into(),
            action: "noop".into(),
            payload: String::new(),
            score,
            icon_data_url: None,
        }
    }

    #[test]
    fn 空查询时应用结果最多保留12条() {
        let mut items = vec![item("command", "Cmd", 50)];
        for i in 0..20 {
            items.push(item("app", &format!("App{i:02}"), 1));
        }
        let out = finalize_search_items(items, true);
        let apps = out.iter().filter(|i| i.kind == "app").count();
        assert_eq!(apps, 12);
        assert!(out.iter().any(|i| i.kind == "command"));
    }

    #[test]
    fn 有关键字时搜索结果最多保留40条() {
        let items: Vec<_> = (0..50)
            .map(|i| item("app", &format!("A{i}"), 100 - i))
            .collect();
        let out = finalize_search_items(items, false);
        assert_eq!(out.len(), 40);
        assert_eq!(out[0].title, "A0");
    }

    /// 目的：搜「设置」能命中 Quickbar 设置入口
    /// 运行：cd src-tauri && cargo test 搜索设置命中宿主导航 -- --nocapture
    #[test]
    fn 搜索设置命中宿主导航() {
        let items = host_nav_items("设置");
        assert!(
            items.iter().any(|i| i.action == "open_settings"),
            "应能搜到 Quickbar 设置: {items:?}"
        );
        let settings = items
            .iter()
            .find(|i| i.action == "open_settings")
            .unwrap();
        assert!(settings.score >= 200, "精确匹配应高分: {}", settings.score);

        let by_pinyin = host_nav_items("shezhi");
        assert!(by_pinyin.iter().any(|i| i.action == "open_settings"));

        let market = host_nav_items("市场");
        assert!(market.iter().any(|i| i.action == "open_market"));
    }

    #[test]
    fn 网页地址规范化() {
        assert_eq!(
            normalize_web_url("https://linux.do/").unwrap(),
            "https://linux.do/"
        );
        assert_eq!(
            normalize_web_url("www.v2ex.com").unwrap(),
            "https://www.v2ex.com"
        );
        assert!(normalize_web_url("").is_err());
        assert!(normalize_web_url("not-a-url").is_err());
    }

    #[test]
    fn 搜索内置网页入口() {
        let linux = host_nav_items("linux");
        assert!(
            linux.iter().any(|i| i.payload == "https://linux.do/"),
            "应能搜到 LINUX DO: {linux:?}"
        );
        let v2 = host_nav_items("v2ex");
        assert!(
            v2.iter().any(|i| i.payload == "https://www.v2ex.com/"),
            "应能搜到 V2EX: {v2:?}"
        );
    }

    #[test]
    fn 市场本地包候选路径顺序正确() {
        let market = PathBuf::from("/home/u/.quickbar/market");
        let res = PathBuf::from("/app/resources");
        let cwd = PathBuf::from("/repo");
        let c = local_market_path_candidates("packages/hello", &market, Some(&res), &cwd);
        assert_eq!(c[0], market.join("packages/hello"));
        assert_eq!(c[1], res.join("market/packages/hello"));
        assert_eq!(c[2], res.join("_up_/market/packages/hello"));
        assert_eq!(c[3], res.join("packages/hello"));
        assert_eq!(c[4], cwd.join("market/packages/hello"));
    }

    /// 目的：剪贴板多文件时优先取第一个可启动路径
    #[test]
    fn 候选路径取第一个可启动() {
        let dir = std::env::temp_dir().join(format!(
            "quickbar-clip-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let txt = dir.join("readme.txt");
        let exe = dir.join("app.exe");
        fs::write(&txt, b"x").unwrap();
        fs::write(&exe, b"MZ").unwrap();

        let txt_s = txt.to_string_lossy().to_string();
        let exe_s = exe.to_string_lossy().to_string();
        let picked = first_launchable_from_candidates([txt_s.as_str(), exe_s.as_str()]);
        assert_eq!(picked.as_deref(), Some(exe_s.as_str()));

        let none = first_launchable_from_candidates([txt_s.as_str()]);
        assert!(none.is_none());

        let _ = fs::remove_dir_all(&dir);
    }
}

