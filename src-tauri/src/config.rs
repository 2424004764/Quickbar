//! 本地配置：热键与用户自定义命令（无登录）

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCommand {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

/// 用户加入的本地启动项（粘贴 exe/lnk）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomApp {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// 全局热键，默认 Ctrl+Space（勿用 Alt+Space）
    pub hotkey: String,
    /// 界面主题：dark / light / system（随系统）
    #[serde(default = "default_theme")]
    pub theme: String,
    /// 用户自定义命令
    #[serde(default)]
    pub commands: Vec<UserCommand>,
    /// 本地启动（用户添加的 exe / lnk）
    #[serde(default)]
    pub custom_apps: Vec<CustomApp>,
    /// 内部市场 catalog 路径（可指向内网目录）
    #[serde(default = "default_catalog_rel")]
    pub market_catalog: String,
    /// 云端市场基址，如 http://127.0.0.1:8787；空则仅用本地市场
    #[serde(default)]
    pub market_base_url: String,
}

fn default_catalog_rel() -> String {
    "market/catalog.json".to_string()
}

fn default_theme() -> String {
    "system".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            // Windows 上 Alt+Space 是系统窗口菜单，作全局热键易重入崩溃
            hotkey: "Ctrl+Space".to_string(),
            theme: default_theme(),
            commands: vec![],
            custom_apps: vec![],
            market_catalog: default_catalog_rel(),
            market_base_url: String::new(),
        }
    }
}

/// 返回 ~/.quickbar 数据根目录
pub fn data_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".quickbar")
}

pub fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

pub fn plugins_dir() -> PathBuf {
    data_dir().join("plugins")
}

pub fn market_dir() -> PathBuf {
    data_dir().join("market")
}

/// 确保数据目录存在；缺失配置时直接写文件（禁止再调 save_config，避免递归）
pub fn ensure_data_dirs() -> Result<(), String> {
    fs::create_dir_all(plugins_dir()).map_err(|e| e.to_string())?;
    fs::create_dir_all(market_dir()).map_err(|e| e.to_string())?;
    fs::create_dir_all(data_dir().join("icon_cache")).map_err(|e| e.to_string())?;
    if !config_path().exists() {
        let raw =
            serde_json::to_string_pretty(&AppConfig::default()).map_err(|e| e.to_string())?;
        fs::write(config_path(), raw).map_err(|e| e.to_string())?;
    }
    purge_removed_demos();
    Ok(())
}

/// 已下线的演示/占位插件 id（不再加载，并尽量从本机数据目录清除）
pub fn removed_plugin_ids() -> &'static [&'static str] {
    &["hello-tool", "apps", "commands"]
}

/// 清理本机残留的演示项：插件目录、市场包、catalog、默认 Hello 命令
pub fn purge_removed_demos() {
    for id in removed_plugin_ids() {
        let plugin_path = plugins_dir().join(id);
        if plugin_path.exists() {
            let _ = fs::remove_dir_all(&plugin_path);
        }
        let package_path = market_dir().join("packages").join(id);
        if package_path.exists() {
            let _ = fs::remove_dir_all(&package_path);
        }
    }

    let catalog_path = market_dir().join("catalog.json");
    if let Ok(raw) = fs::read_to_string(&catalog_path) {
        if let Ok(mut items) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
            let before = items.len();
            items.retain(|item| {
                !matches!(
                    item.get("id").and_then(|v| v.as_str()),
                    Some("hello-tool")
                )
            });
            if items.len() != before {
                if let Ok(next) = serde_json::to_string_pretty(&items) {
                    let _ = fs::write(&catalog_path, next);
                }
            }
        }
    }

    // 直接读写，避免与 save_config / ensure_data_dirs 互相递归
    let path = config_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(mut config) = serde_json::from_str::<AppConfig>(&raw) {
            let before = config.commands.len();
            config.commands.retain(|c| c.id != "hello");
            if config.commands.len() != before {
                if let Ok(next) = serde_json::to_string_pretty(&config) {
                    let _ = fs::write(&path, next);
                }
            }
        }
    }
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path(), raw).map_err(|e| e.to_string())
}
