//! 全局唤起热键：解析、注册、设置页命令

use crate::config::{load_config, save_config, AppConfig};
use std::str::FromStr;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

fn default_hotkey_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL), Code::Space)
}

/// 启动时注册用：解析失败则回退 Ctrl+Space
pub fn parse_hotkey(hotkey: &str) -> Shortcut {
    try_parse_hotkey(hotkey).unwrap_or_else(|_| default_hotkey_shortcut())
}

/// 规范化热键展示字符串（Ctrl+Space）
pub fn normalize_hotkey(hotkey: &str) -> String {
    hotkey
        .split('+')
        .map(|part| {
            let t = part.trim();
            match t.to_ascii_lowercase().as_str() {
                "ctrl" | "control" | "commandorcontrol" => "Ctrl".to_string(),
                "alt" | "option" => "Alt".to_string(),
                "shift" => "Shift".to_string(),
                "meta" | "super" | "cmd" | "command" | "win" => "Meta".to_string(),
                "space" | " " => "Space".to_string(),
                "esc" => "Escape".to_string(),
                other => {
                    if other.len() == 1 {
                        other.to_ascii_uppercase()
                    } else if other.starts_with('f')
                        && other.len() > 1
                        && other[1..].chars().all(|c| c.is_ascii_digit())
                    {
                        format!("F{}", &other[1..])
                    } else {
                        let mut chars = t.chars();
                        match chars.next() {
                            Some(first) => {
                                first.to_uppercase().collect::<String>() + chars.as_str()
                            }
                            None => t.to_string(),
                        }
                    }
                }
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}

/// 校验并解析热键；拒绝空串与 Windows 冲突的 Alt+Space
pub fn try_parse_hotkey(hotkey: &str) -> Result<Shortcut, String> {
    let trimmed = hotkey.trim();
    if trimmed.is_empty() {
        return Err("热键不能为空".to_string());
    }
    let compact = trimmed.replace(' ', "").to_ascii_lowercase();
    if compact == "alt+space" {
        return Err("Alt+Space 与 Windows 系统菜单冲突，请换其它组合".to_string());
    }
    let normalized = normalize_hotkey(trimmed);
    Shortcut::from_str(&normalized).map_err(|err| format!("无效热键「{normalized}」: {err}"))
}

/// 更新唤起热键：注销旧键、注册新键并写入 config.json
#[tauri::command]
pub fn set_hotkey(app: AppHandle, hotkey: String) -> Result<AppConfig, String> {
    let mut config = load_config();
    let normalized = normalize_hotkey(&hotkey);
    let new_shortcut = try_parse_hotkey(&normalized)?;

    let old_compact = config.hotkey.replace(' ', "").to_ascii_lowercase();
    let new_compact = normalized.replace(' ', "").to_ascii_lowercase();
    if old_compact == new_compact {
        config.hotkey = normalized;
        return Ok(config);
    }

    let old_shortcut =
        try_parse_hotkey(&config.hotkey).unwrap_or_else(|_| default_hotkey_shortcut());
    let gs = app.global_shortcut();
    let _ = gs.unregister(old_shortcut);
    if let Err(err) = gs.register(new_shortcut) {
        let _ = gs.register(old_shortcut);
        return Err(format!("注册失败（可能与其它软件冲突）: {err}"));
    }

    config.hotkey = normalized;
    save_config(&config)?;
    Ok(config)
}

/// 录制热键时暂时注销全局快捷键，避免误唤起/隐藏
#[tauri::command]
pub fn suspend_global_hotkey(app: AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())
}

/// 录制结束或取消后，按当前配置重新注册热键
#[tauri::command]
pub fn resume_global_hotkey(app: AppHandle) -> Result<(), String> {
    let config = load_config();
    let shortcut = try_parse_hotkey(&config.hotkey)?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(shortcut)
        .map_err(|e| format!("恢复热键失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{normalize_hotkey, try_parse_hotkey};

    /// 目的：规范化修饰键别名与字母大小写，保证写入 config 的展示一致。
    /// 运行：cd src-tauri && cargo test hotkey::tests::normalize_hotkey_aliases -- --nocapture
    #[test]
    fn normalize_hotkey_aliases() {
        assert_eq!(normalize_hotkey("ctrl + space"), "Ctrl+Space");
        assert_eq!(normalize_hotkey("CONTROL+SHIFT+a"), "Ctrl+Shift+A");
        assert_eq!(normalize_hotkey("alt+q"), "Alt+Q");
    }

    /// 目的：拒绝空串与 Windows Alt+Space；合法组合可解析。
    /// 运行：cd src-tauri && cargo test hotkey::tests::try_parse_hotkey_rules -- --nocapture
    #[test]
    fn try_parse_hotkey_rules() {
        assert!(try_parse_hotkey("").is_err());
        assert!(try_parse_hotkey("Alt+Space").is_err());
        assert!(try_parse_hotkey("Ctrl+Space").is_ok());
        assert!(try_parse_hotkey("Alt+Q").is_ok());
    }
}
