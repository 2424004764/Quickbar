mod apps;
mod commands;
mod config;
mod hotkey;
mod plugin;

use commands::AppState;
use config::{ensure_data_dirs, load_config, save_config};
use hotkey::parse_hotkey;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// 防止热键/托盘事件在主线程重入导致栈溢出
static TOGGLE_GUARD: AtomicBool = AtomicBool::new(false);

/// 鼠标所在显示器（找不到则回退当前/主屏）
fn monitor_under_cursor(win: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    let cursor = win.cursor_position().ok()?;
    win.monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten())
}

/// 将窗口居中到「鼠标所在显示器」（多屏时跟鼠标所在屏）
fn place_on_cursor_monitor(win: &tauri::WebviewWindow) {
    let Some(monitor) = monitor_under_cursor(win) else {
        let _ = win.center();
        return;
    };

    let area = monitor.work_area();
    let area_x = area.position.x;
    let area_y = area.position.y;
    let area_w = area.size.width as i32;
    let area_h = area.size.height as i32;

    let win_size = win
        .outer_size()
        .unwrap_or_else(|_| tauri::PhysicalSize::new(720, 390));
    let win_w = win_size.width as i32;
    let win_h = win_size.height as i32;

    let x = area_x + ((area_w - win_w) / 2).max(0);
    let y = area_y + ((area_h - win_h) / 2).max(0);

    let _ = win.set_position(PhysicalPosition::new(x, y));
}

/// 鼠标是否已在另一块显示器上（窗口已显示时用于“跟屏移动”）
fn cursor_on_other_monitor(win: &tauri::WebviewWindow) -> bool {
    let Some(cursor_mon) = monitor_under_cursor(win) else {
        return false;
    };
    let Some(win_mon) = win.current_monitor().ok().flatten() else {
        return true;
    };
    cursor_mon.position() != win_mon.position()
}

/// 显示并聚焦启动器窗口
pub fn show_launcher(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        // 先按鼠标所在屏定位，再显示，避免闪到主屏
        place_on_cursor_monitor(&win);
        win.show().map_err(|e| e.to_string())?;
        // 显示后尺寸可能已稳定，再居中一次
        place_on_cursor_monitor(&win);
        force_window_foreground(&win);
        // 后台重扫应用索引（刚装软件）；前端也会 await refresh_app_index
        std::thread::spawn(|| {
            let _ = apps::refresh_apps();
        });
        // 仅通知窗口已显示，由前端决定是否重置页面（保留插件会话）
        let _ = app.emit("quickbar://window-shown", ());
    }
    Ok(())
}

/// 尽量把窗口拉到前台（Windows 会限制跨进程抢焦点，需额外处理）
fn force_window_foreground(win: &tauri::WebviewWindow) {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
    // 短暂切换置顶状态，绕过 Windows 前台锁定；主窗配置本身是 alwaysOnTop
    #[cfg(windows)]
    {
        let _ = win.set_always_on_top(false);
        let _ = win.set_always_on_top(true);
        let _ = win.set_focus();
    }
}

/// 重复启动时：在主线程把已有窗口拉到前台
fn focus_existing_launcher(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Err(err) = show_launcher(&app) {
            eprintln!("focus existing launcher failed: {err}");
        }
    });
}

fn hide_launcher(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

fn toggle_launcher(app: &AppHandle) {
    if TOGGLE_GUARD.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = (|| {
        if let Some(win) = app.get_webview_window("main") {
            if win.is_visible().unwrap_or(false) {
                // 已打开但鼠标在另一块屏：跟屏移动，而不是关闭
                if cursor_on_other_monitor(&win) {
                    place_on_cursor_monitor(&win);
                    let _ = win.set_focus();
                    let _ = app.emit("quickbar://window-shown", ());
                } else {
                    hide_launcher(app);
                }
            } else {
                show_launcher(app)?;
            }
        }
        Ok::<(), String>(())
    })();
    TOGGLE_GUARD.store(false, Ordering::SeqCst);
    if let Err(err) = result {
        eprintln!("toggle_launcher failed: {err}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 单实例必须最先注册：二次启动时把已有窗口拉到前台，避免双托盘/热键冲突
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_existing_launcher(app);
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_launcher(app);
                    }
                })
                .build(),
        )
        .manage(AppState {
            resource_dir: parking_lot::RwLock::new(None),
            allow_blur_hide: parking_lot::RwLock::new(true),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_app_config,
            commands::set_theme,
            commands::refresh_app_index,
            commands::get_app_icon,
            commands::add_custom_app,
            commands::remove_custom_app,
            commands::list_custom_apps,
            commands::list_plugins,
            commands::search,
            commands::open_path,
            commands::run_user_command,
            commands::run_shell_command,
            commands::hide_main_window,
            commands::show_main_window,
            commands::list_market,
            commands::install_plugin_from_path,
            commands::install_market_item,
            commands::submit_market_plugin,
            commands::uninstall_plugin,
            commands::add_user_command,
            commands::set_blur_hide_enabled,
            hotkey::set_hotkey,
            hotkey::suspend_global_hotkey,
            hotkey::resume_global_hotkey,
        ])
        .setup(|app| {
            let _ = ensure_data_dirs();

            // 迁移危险热键
            let mut config = load_config();
            let key = config.hotkey.replace(' ', "").to_lowercase();
            if key == "alt+space" || key.is_empty() {
                config.hotkey = "Ctrl+Space".to_string();
                let _ = save_config(&config);
            }

            if let Ok(dir) = app.path().resource_dir() {
                *app.state::<AppState>().resource_dir.write() = Some(dir);
            }

            std::thread::spawn(|| {
                let _ = apps::refresh_apps();
            });

            let show_i = MenuItem::with_id(app, "show", "显示 Quickbar", true, None::<&str>)?;
            let market_i = MenuItem::with_id(app, "market", "打开应用市场", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &market_i, &settings_i, &quit_i])?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .expect("missing window icon");
            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Quickbar")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = show_launcher(app);
                    }
                    "market" => {
                        let _ = show_launcher(app);
                        let _ = app.emit("quickbar://open-market", ());
                    }
                    "settings" => {
                        let _ = show_launcher(app);
                        let _ = app.emit("quickbar://open-settings", ());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_launcher(tray.app_handle());
                    }
                })
                .build(app)?;

            // 推迟注册热键，避开启动阶段与系统钩子重入
            let app_handle = app.handle().clone();
            let hotkey = config.hotkey.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(400));
                let shortcut = parse_hotkey(&hotkey);
                let app_for_register = app_handle.clone();
                let _ = app_handle.run_on_main_thread(move || {
                    if let Err(err) = app_for_register.global_shortcut().register(shortcut) {
                        eprintln!("register hotkey failed: {err}");
                    }
                });
            });

            // 失焦隐藏：短延迟后关闭，避免点击结果项时被抢焦点立刻关掉
            if let Some(win) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        let app_handle = app_handle.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(120));
                            let allow = *app_handle.state::<AppState>().allow_blur_hide.read();
                            if !allow {
                                return;
                            }
                            if let Some(w) = app_handle.get_webview_window("main") {
                                if w.is_visible().unwrap_or(false)
                                    && !w.is_focused().unwrap_or(false)
                                {
                                    let _ = w.hide();
                                }
                            }
                        });
                    }
                });
            }

            // 双击 exe 首次启动：弹出主界面（否则只在托盘，用户以为没启动）
            // 启动阶段暂关失焦隐藏，避免 WebView 抢焦点后立刻被关掉
            *app.state::<AppState>().allow_blur_hide.write() = false;
            let app_startup = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(280));
                let app_show = app_startup.clone();
                let app_after = app_startup.clone();
                let _ = app_startup.run_on_main_thread(move || {
                    if let Err(err) = show_launcher(&app_show) {
                        eprintln!("show on startup failed: {err}");
                    }
                });
                std::thread::sleep(std::time::Duration::from_millis(900));
                *app_after.state::<AppState>().allow_blur_hide.write() = true;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running quickbar");
}
