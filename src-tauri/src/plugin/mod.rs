//! 插件宿主：扫描内建与用户安装的 plugin.json

use crate::config::{plugins_dir, removed_plugin_ids, AppConfig};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommand {
    pub code: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMarketMeta {
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub entrypoint: String,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub commands: Vec<PluginCommand>,
    #[serde(default)]
    pub market: Option<PluginMarketMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPlugin {
    pub manifest: PluginManifest,
    pub root: String,
    pub builtin: bool,
}

/// 解析资源目录：优先 Tauri resource_dir，开发态回退到仓库根
pub fn resolve_resource_roots(resource_dir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = resource_dir {
        roots.push(dir.join("plugins"));
        // Tauri 2：`../plugins` 资源会落在 `$RESOURCE/_up_/plugins`
        roots.push(dir.join("_up_").join("plugins"));
        // bundle 可能把 resources 展平
        roots.push(dir.clone());
    }
    // 开发态：src-tauri 的上一级
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.join("plugins"));
        roots.push(cwd.join("../plugins"));
        if let Some(parent) = cwd.parent() {
            roots.push(parent.join("plugins"));
        }
    }
    roots
}

pub fn load_all_plugins(resource_dir: Option<PathBuf>) -> Vec<LoadedPlugin> {
    let mut plugins = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for root in resolve_resource_roots(resource_dir) {
        for p in scan_plugin_dir(&root, true) {
            if seen.insert(p.manifest.id.clone()) {
                plugins.push(p);
            }
        }
    }

    let user_root = plugins_dir();
    for p in scan_plugin_dir(&user_root, false) {
        // 用户安装覆盖同 id 内建
        if let Some(idx) = plugins.iter().position(|x| x.manifest.id == p.manifest.id) {
            plugins[idx] = p;
        } else {
            plugins.push(p);
        }
    }

    plugins.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    plugins
}

fn scan_plugin_dir(root: &Path, builtin: bool) -> Vec<LoadedPlugin> {
    let mut out = Vec::new();
    if !root.exists() {
        return out;
    }

    // 支持 root/plugin.json 或 root/<id>/plugin.json
    let direct = root.join("plugin.json");
    if direct.exists() {
        if let Some(p) = read_manifest(&direct, root, builtin) {
            out.push(p);
        }
        return out;
    }

    for entry in WalkDir::new(root).max_depth(2).into_iter().flatten() {
        let path = entry.path();
        if path.file_name().and_then(|n| n.to_str()) != Some("plugin.json") {
            continue;
        }
        let plugin_root = path.parent().unwrap_or(root);
        if let Some(p) = read_manifest(path, plugin_root, builtin) {
            out.push(p);
        }
    }
    out
}

fn read_manifest(path: &Path, root: &Path, builtin: bool) -> Option<LoadedPlugin> {
    let raw = fs::read_to_string(path).ok()?;
    let manifest = parse_manifest_json(&raw).ok()?;
    if removed_plugin_ids().contains(&manifest.id.as_str()) {
        return None;
    }
    Some(LoadedPlugin {
        manifest,
        root: root.to_string_lossy().to_string(),
        builtin,
    })
}

/// 解析 plugin.json 文本
pub fn parse_manifest_json(raw: &str) -> Result<PluginManifest, String> {
    serde_json::from_str(raw).map_err(|e| e.to_string())
}

/// 将插件声明的搜索入口转为可展示项（宿主侧聚合）
pub fn plugin_search_hints(plugins: &[LoadedPlugin], query: &str) -> Vec<crate::commands::SearchItem> {
    let q = query.trim().to_lowercase();
    let mut items = Vec::new();
    for p in plugins {
        let hay = format!(
            "{} {} {}",
            p.manifest.name, p.manifest.description, p.manifest.id
        )
        .to_lowercase();
        if q.is_empty() || hay.contains(&q) || p.manifest.id.contains(&q) {
            for feat in &p.manifest.features {
                if feat == "search" || feat == "action" {
                    items.push(crate::commands::SearchItem {
                        id: format!("plugin:{}", p.manifest.id),
                        title: p.manifest.name.clone(),
                        subtitle: p.manifest.description.clone(),
                        kind: "plugin".to_string(),
                        action: if p.manifest.id == "market" {
                            "open_market".to_string()
                        } else {
                            "open_plugin".to_string()
                        },
                        payload: p.manifest.id.clone(),
                        score: if q.is_empty() { 10 } else { 40 },
                        icon_data_url: None,
                    });
                    break;
                }
            }
        }
        for cmd in &p.manifest.commands {
            let label = format!("{} {}", cmd.label, cmd.code).to_lowercase();
            if !q.is_empty() && !label.contains(&q) && !hay_contains_plugin(p, &q) {
                continue;
            }
            // 市场入口走 open_market；其余命令打开对应插件页
            let is_market = cmd.code == "market" || p.manifest.id == "market";
            items.push(crate::commands::SearchItem {
                id: format!("plugin-cmd:{}:{}", p.manifest.id, cmd.code),
                title: cmd.label.clone(),
                subtitle: format!("插件 · {}", p.manifest.name),
                kind: "plugin".to_string(),
                action: if is_market {
                    "open_market".to_string()
                } else {
                    "open_plugin".to_string()
                },
                payload: if is_market {
                    "market".to_string()
                } else {
                    p.manifest.id.clone()
                },
                score: 35,
                icon_data_url: None,
            });
        }
    }
    items
}

fn hay_contains_plugin(p: &LoadedPlugin, q: &str) -> bool {
    format!("{} {}", p.manifest.name, p.manifest.id)
        .to_lowercase()
        .contains(q)
}

/// 用户命令搜索
pub fn user_command_items(config: &AppConfig, query: &str) -> Vec<crate::commands::SearchItem> {
    let q = query.trim().to_lowercase();
    config
        .commands
        .iter()
        .filter(|c| {
            q.is_empty()
                || c.name.to_lowercase().contains(&q)
                || c.command.to_lowercase().contains(&q)
                || c.id.to_lowercase().contains(&q)
        })
        .map(|c| crate::commands::SearchItem {
            id: format!("cmd:{}", c.id),
            title: c.name.clone(),
            subtitle: format!("命令 · {} {}", c.command, c.args.join(" ")),
            kind: "command".to_string(),
            action: "run_command".to_string(),
            payload: c.id.clone(),
            score: 50,
            icon_data_url: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AppConfig, UserCommand};
    use std::io::Write;

    #[test]
    fn 解析插件清单_成功() {
        let raw = r#"{
          "id": "json-format",
          "name": "JSON",
          "version": "0.1.0",
          "features": ["action"],
          "commands": [{ "code": "json", "label": "JSON 工具" }]
        }"#;
        let m = parse_manifest_json(raw).unwrap();
        assert_eq!(m.id, "json-format");
        assert_eq!(m.commands.len(), 1);
    }

    #[test]
    fn 解析插件清单_坏json应失败() {
        assert!(parse_manifest_json("{").is_err());
    }

    #[test]
    fn 扫描插件目录_能读到清单文件() {
        let dir = std::env::temp_dir().join(format!("qb_plugin_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut f = fs::File::create(dir.join("plugin.json")).unwrap();
        write!(
            f,
            r#"{{"id":"t1","name":"T1","version":"1.0.0","features":["search"]}}"#
        )
        .unwrap();
        let loaded = scan_plugin_dir(&dir, true);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].manifest.id, "t1");
        assert!(loaded[0].builtin);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 用户命令搜索_按关键字过滤() {
        let cfg = AppConfig {
            commands: vec![UserCommand {
                id: "echo-demo".into(),
                name: "Echo Demo".into(),
                command: "echo".into(),
                args: vec![],
            }],
            ..Default::default()
        };
        let hit = user_command_items(&cfg, "echo");
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].action, "run_command");
        let miss = user_command_items(&cfg, "zzz-not-found");
        assert!(miss.is_empty());
    }

    #[test]
    fn 插件搜索_按名称命中() {
        let plugins = vec![LoadedPlugin {
            manifest: PluginManifest {
                id: "json-format".into(),
                name: "JSON 编辑器".into(),
                version: "0.1.0".into(),
                author: String::new(),
                description: "格式化".into(),
                entrypoint: String::new(),
                features: vec!["action".into()],
                commands: vec![],
                market: None,
            },
            root: "/tmp".into(),
            builtin: false,
        }];
        let items = plugin_search_hints(&plugins, "json");
        assert!(!items.is_empty());
        assert_eq!(items[0].payload, "json-format");
    }
}
