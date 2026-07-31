//! 主窗 / 分离窗内嵌网页（子 WebView）
//! 每个宿主窗口一份子 WebView，label = browser-{hostWindowLabel}

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect,
    Webview, WebviewUrl, Window,
};

static HOST_TO_CHILD: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 串行化子 WebView 创建
static CREATE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// 前端传来的区域：CSS 像素，外加宿主 WebView 的视口尺寸
///
/// 不能直接当逻辑/物理像素用：DPI 缩放下 CSS px、窗口逻辑 px、物理 px 三者可能都不等，
/// 而 `devicePixelRatio` 在 WebView2 里也未必等于窗口缩放。用「窗口物理宽 ÷ 视口 CSS 宽」
/// 现算比例最稳，算出来直接给物理像素。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
}

impl BrowserBounds {
    /// 换算成窗口物理像素
    fn to_rect(&self, window: &Window) -> Rect {
        let (sx, sy) = self.scale(window);
        let position = PhysicalPosition::new((self.x * sx).round() as i32, (self.y * sy).round() as i32);
        let size = PhysicalSize::new(
            (self.width * sx).round().max(1.0) as u32,
            (self.height * sy).round().max(1.0) as u32,
        );
        Rect {
            position: position.into(),
            size: size.into(),
        }
    }

    fn scale(&self, window: &Window) -> (f64, f64) {
        let fallback = window.scale_factor().unwrap_or(1.0);
        let Ok(inner) = window.inner_size() else {
            return (fallback, fallback);
        };
        if self.viewport_width < 1.0 || self.viewport_height < 1.0 {
            return (fallback, fallback);
        }
        (
            f64::from(inner.width) / self.viewport_width,
            f64::from(inner.height) / self.viewport_height,
        )
    }
}

/// 网页里的按键回传给宿主
///
/// 远程页面拿不到 Tauri IPC（ACL 只放行本地来源），所以借一次「会被取消的导航」当信使：
/// 页面按 Esc 就跳 `https://quickbar.invalid/esc`，导航回调认出这个域名后拦下并发事件。
const KEY_BRIDGE_HOST: &str = "quickbar.invalid";

const KEY_BRIDGE_SCRIPT: &str = r#"
(function () {
  if (window.__qbKeyBridge) { return; }
  window.__qbKeyBridge = true;
  window.addEventListener(
    "keydown",
    function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        window.location.href = "https://quickbar.invalid/esc";
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        window.location.href = "https://quickbar.invalid/detach";
      }
    },
    true,
  );
})();
"#;

fn parse_url(raw: &str) -> Result<url::Url, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("网址为空".into());
    }
    let with_scheme = if s.starts_with("http://") || s.starts_with("https://") {
        s.to_string()
    } else {
        format!("https://{s}")
    };
    url::Url::parse(&with_scheme).map_err(|e| format!("无效网址: {e}"))
}

fn child_label_for_host(host_label: &str) -> String {
    let safe: String = host_label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("browser-{safe}")
}

/// 关掉宿主窗口下的内嵌网页
///
/// 不只按记录的 label 关：把该窗口下所有 `browser-` 开头的子 WebView 一并扫掉，
/// 避免任何一次记录失配就在启动器上留一块关不掉的网页。
fn close_child_for_host(app: &AppHandle, host_label: &str) {
    HOST_TO_CHILD.lock().remove(host_label);

    let mut labels = vec![child_label_for_host(host_label)];
    if let Some(host) = app.get_webview(host_label) {
        for wv in host.window().webviews() {
            if wv.label().starts_with("browser-") && !labels.iter().any(|l| l == wv.label()) {
                labels.push(wv.label().to_string());
            }
        }
    }
    log_browser(format!(
        "close host={host_label} candidates={labels:?} known={:?}",
        app.webviews().keys().collect::<Vec<_>>()
    ));

    for label in labels {
        let Some(wv) = app.get_webview(&label) else {
            log_browser(format!("close: webview {label} not found in manager"));
            continue;
        };
        // 先藏起来：close 走事件循环，隐藏能立刻让启动器不被盖住
        let _ = wv.hide();
        // 断开页面，停掉音视频与定时器，避免关闭前还在后台跑
        if let Ok(blank) = url::Url::parse("about:blank") {
            let _ = wv.navigate(blank);
        }
        match wv.close() {
            Ok(()) => log_browser(format!(
                "close {label}: ok, still-known={}",
                app.get_webview(&label).is_some()
            )),
            Err(err) => log_browser(format!("close {label} failed: {err}")),
        }
    }
}

/// 调试内嵌浏览器用；`quickbar_browser_debug` 环境变量或 dev 构建下才打印
fn log_browser(msg: impl AsRef<str>) {
    if cfg!(debug_assertions) || std::env::var_os("QUICKBAR_BROWSER_DEBUG").is_some() {
        eprintln!("[qb-browser] {}", msg.as_ref());
    }
}

/// 在调用方窗口内打开 / 导航网页
///
/// 参数用 `Webview` 而不是 `WebviewWindow`：窗口一旦挂了子 WebView，
/// `WebviewWindow` 的提取就会失败（"current webview is not a WebviewWindow"），
/// 后续所有尺寸/关闭命令都会被拒。
///
/// 必须 async：`Window::add_child` 会把创建任务投递到主线程再阻塞等回执，
/// 同步命令本身就跑在主线程上，会自等死锁（整个事件循环卡死，托盘也失灵）。
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    webview: Webview,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || browser_open_blocking(app, webview, url, bounds))
        .await
        .map_err(|e| format!("任务失败: {e}"))?
}

fn browser_open_blocking(
    app: AppHandle,
    webview: Webview,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let parsed = parse_url(&url)?;
    if bounds.width < 40.0 || bounds.height < 40.0 {
        return Err("浏览器区域过小".into());
    }

    // 前端可能连发两次（StrictMode / 快速切换），串行化避免重复建同名 webview
    let _creating = CREATE_LOCK.lock();

    let host_label = webview.label().to_string();
    let child_label = child_label_for_host(&host_label);
    let window = webview.window();

    let rect = bounds.to_rect(&window);
    log_browser(format!(
        "open host={host_label} css=({},{} {}x{}) viewport={}x{} inner={:?} scale={:?} -> {:?}",
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        bounds.viewport_width,
        bounds.viewport_height,
        window.inner_size().ok(),
        window.scale_factor().ok(),
        rect
    ));

    // 已有则导航 + 调整位置
    if let Some(wv) = app.get_webview(&child_label) {
        wv.navigate(parsed).map_err(|e| e.to_string())?;
        let _ = wv.set_bounds(rect);
        let _ = wv.show();
        HOST_TO_CHILD.lock().insert(host_label, child_label);
        return Ok(());
    }

    // 不开 auto_resize：它会在每个 Resized 事件里按创建时的比例覆写我们算好的位置，
    // 主窗展开动画期间就会把页面按旧比例缩回去。尺寸完全由前端 ResizeObserver 驱动。
    let app_for_nav = app.clone();
    let host_for_nav = host_label.clone();
    let builder = WebviewBuilder::new(child_label.clone(), WebviewUrl::External(parsed))
        .initialization_script(KEY_BRIDGE_SCRIPT)
        .on_navigation(move |url| {
            if url.host_str() != Some(KEY_BRIDGE_HOST) {
                return true;
            }
            let action = url.path().trim_start_matches('/').to_string();
            let _ = app_for_nav.emit_to(host_for_nav.as_str(), "quickbar://browser-key", action);
            false
        });

    let wv = window
        .add_child(builder, rect.position, rect.size)
        .map_err(|e| format!("创建内嵌浏览器失败: {e}"))?;

    let _ = wv.set_bounds(rect);
    HOST_TO_CHILD.lock().insert(host_label, child_label);
    Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    webview: Webview,
    bounds: BrowserBounds,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 与创建互斥：创建期间尺寸请求先等一等，避免打到还没建好的 webview
        let _guard = CREATE_LOCK.lock();
        let host_label = webview.label().to_string();
        let child_label = HOST_TO_CHILD
            .lock()
            .get(&host_label)
            .cloned()
            .unwrap_or_else(|| child_label_for_host(&host_label));
        let Some(wv) = app.get_webview(&child_label) else {
            log_browser(format!("set_bounds: {child_label} not found"));
            return Ok(());
        };
        let rect = bounds.to_rect(&webview.window());
        log_browser(format!("set_bounds {child_label} -> {rect:?}"));
        wv.set_bounds(rect).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, webview: Webview) -> Result<(), String> {
    log_browser(format!("close requested by {}", webview.label()));
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CREATE_LOCK.lock();
        close_child_for_host(&app, webview.label());
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))
}

/// 打开顶栏菜单等 HTML 浮层时先把子 WebView 藏起来，否则原生页面会盖住浮层
#[tauri::command]
pub async fn browser_set_visible(
    app: AppHandle,
    webview: Webview,
    visible: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let host_label = webview.label().to_string();
        let child_label = HOST_TO_CHILD
            .lock()
            .get(&host_label)
            .cloned()
            .unwrap_or_else(|| child_label_for_host(&host_label));
        let Some(wv) = app.get_webview(&child_label) else {
            return Ok(());
        };
        if visible { wv.show() } else { wv.hide() }.map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 内嵌网页导航：上一页 / 下一页 / 刷新
#[tauri::command]
pub async fn browser_nav(
    app: AppHandle,
    webview: Webview,
    action: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let host_label = webview.label().to_string();
        let child_label = HOST_TO_CHILD
            .lock()
            .get(&host_label)
            .cloned()
            .unwrap_or_else(|| child_label_for_host(&host_label));
        let Some(wv) = app.get_webview(&child_label) else {
            return Err("内嵌网页未打开".into());
        };
        let script = match action.as_str() {
            "back" => "try{history.back()}catch(e){}",
            "forward" => "try{history.forward()}catch(e){}",
            "reload" => "try{location.reload()}catch(e){}",
            _ => return Err(format!("未知导航动作: {action}")),
        };
        log_browser(format!("nav {child_label} action={action}"));
        wv.eval(script).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 前端诊断日志（内嵌浏览器排障用，走宿主终端）
#[tauri::command]
pub fn browser_log(message: String) {
    log_browser(format!("fe: {message}"));
}

#[tauri::command]
pub fn browser_is_open(app: AppHandle, webview: Webview) -> bool {
    let host_label = webview.label().to_string();
    let child_label = HOST_TO_CHILD
        .lock()
        .get(&host_label)
        .cloned()
        .unwrap_or_else(|| child_label_for_host(&host_label));
    app.get_webview(&child_label).is_some()
}
