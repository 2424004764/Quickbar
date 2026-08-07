//! 主窗 / 分离窗内嵌网页（子 WebView）
//! 每个宿主窗口一份子 WebView，label = browser-{hostWindowLabel}

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect,
    Webview, WebviewUrl, Window,
};

/// 宿主窗口 -> 子 WebView label。建过就一直留着，只创建一次
static HOST_TO_CHILD: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 正在展示网页的宿主窗口。子 WebView 关闭后不销毁只停用，靠这个区分「有没有网页开着」
static ACTIVE_HOSTS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// 子 WebView 里当前装的网址。停用后页面还在，重开同一网址就只 show，避免再导航一次
static HOST_URL: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// 全局串行化所有子 WebView 操作
///
/// `Window::add_child` 会在主线程上同步建 WebView2 控制器，创建期间 WebView2 自己跑嵌套消息泵，
/// 会把队列里其他窗口的销毁消息一起处理掉 —— 一边建一边毁会把 UI 线程搅死（整个应用假死）。
/// 所以创建/销毁/显隐都要抢同一把锁，且创建后留一段稳定期。
static CHILD_OP_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// 新控制器创建后，WebView2 内部还会继续投递初始化消息，这段时间不要动其他子 WebView
const CREATE_SETTLE_MS: u64 = 200;

/// 等锁上限：真有操作卡住时后面的请求快速失败，而不是一起堆死
const LOCK_WAIT_MS: u64 = 3000;

/// 当前正在执行的子 WebView 操作，供看门狗定位卡点
static CURRENT_OP: Lazy<Mutex<Option<(String, std::time::Instant)>>> = Lazy::new(|| Mutex::new(None));

/// 刚结束的操作（入队≠执行完；看门狗报「进行中: 无」时看这个）
static LAST_OP: Lazy<Mutex<Option<(String, u128)>>> = Lazy::new(|| Mutex::new(None));

/// 主线程卡住时打印这个，能看出卡在哪一步
pub fn current_op_desc() -> String {
    match &*CURRENT_OP.lock() {
        Some((name, since)) => format!("{name}（已 {}ms）", since.elapsed().as_millis()),
        None => "无".into(),
    }
}

pub fn last_op_desc() -> String {
    match &*LAST_OP.lock() {
        Some((name, ms)) => format!("{name}（耗时 {ms}ms）"),
        None => "无".into(),
    }
}

/// 记录进行中的操作，顺带把慢操作打出来
struct OpGuard {
    name: String,
    started: std::time::Instant,
}

impl OpGuard {
    fn new(name: impl Into<String>) -> Self {
        let name = name.into();
        let started = std::time::Instant::now();
        *CURRENT_OP.lock() = Some((name.clone(), started));
        Self { name, started }
    }
}

impl Drop for OpGuard {
    fn drop(&mut self) {
        *CURRENT_OP.lock() = None;
        let ms = self.started.elapsed().as_millis();
        *LAST_OP.lock() = Some((self.name.clone(), ms));
        if ms > 1000 {
            log_browser(format!("{} 耗时 {ms}ms（偏慢）", self.name));
        }
    }
}

/// 在主线程上同步执行 WebView 操作并等待完成（可带回结果）
///
/// 根因：Tauri 从非主线程调 `hide` / `navigate` / `set_bounds` 时，`send_user_message`
/// 只是 `proxy.send_event` 入队就返回，**不等待主线程真正跑完**。
/// 于是我们的锁/OpGuard 只罩住了「入队」，罩不住 WebView2 在 UI 线程上的实际工作；
/// 前端立刻开始的窗口 `setSize` 动画会和这些消息在主线程上交错，WebView2 嵌套消息泵
/// 一搅就卡死好几秒，看门狗却报「进行中的操作: 无」。
///
/// 把关键路径投到主线程并 `recv` 等回执后，命令返回才表示控制器侧已经做完。
fn run_on_main_sync<T: Send + 'static>(
    app: &AppHandle,
    op: &str,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| format!("{op}: 投递主线程失败: {e}"))?;
    rx.recv_timeout(std::time::Duration::from_secs(8))
        .map_err(|_| format!("{op}: 主线程执行超时"))
}

/// 抢子 WebView 操作锁；超时返回 None，调用方直接放弃本次操作
fn lock_child_ops(op: &str) -> Option<parking_lot::MutexGuard<'static, ()>> {
    let guard = CHILD_OP_LOCK.try_lock_for(std::time::Duration::from_millis(LOCK_WAIT_MS));
    if guard.is_none() {
        log_browser(format!(
            "{op}: 等锁超时，跳过（进行中: {}）",
            current_op_desc()
        ));
    }
    guard
}

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

/// 停用宿主窗口下的内嵌网页：只隐藏，不销毁、也不导航走
///
/// - 不 `close()`：销毁控制器会卡主线程
/// - 不 `about:blank`：卸重页面同样卡主线程
/// - 必须在主线程同步 hide 并等回执：见 [`run_on_main_sync`]
///
/// 真正销毁只在宿主窗口关闭时由 Tauri 做。
fn park_child_for_host(app: &AppHandle, host_label: &str) {
    // 已经停用过就别再 hide：返回首页时常被调两次（组件卸载 + App 显式关闭）
    if !ACTIVE_HOSTS.lock().remove(host_label) {
        log_browser(format!("park host={host_label}: already inactive, skip"));
        return;
    }

    let mut labels = vec![child_label_for_host(host_label)];
    if let Some(host) = app.get_webview(host_label) {
        for wv in host.window().webviews() {
            if wv.label().starts_with("browser-") && !labels.iter().any(|l| l == wv.label()) {
                labels.push(wv.label().to_string());
            }
        }
    }
    log_browser(format!("park host={host_label} candidates={labels:?}"));

    let app_main = app.clone();
    let labels_main = labels;
    if let Err(err) = run_on_main_sync(app, "park", move || {
        for label in labels_main {
            let Some(wv) = app_main.get_webview(&label) else {
                continue;
            };
            // 在主线程调用：send_user_message 走同步路径，真正执行完才返回
            let _ = wv.hide();
            let _ = wv.eval(
                r#"try{document.querySelectorAll("video,audio").forEach(function(m){try{m.pause()}catch(e){}})}catch(e){}"#,
            );
            log_browser(format!("park {label}: ok"));
        }
    }) {
        log_browser(format!("park host={host_label} failed: {err}"));
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
    let Some(_creating) = lock_child_ops("open") else {
        return Err("内嵌网页忙，请重试".into());
    };
    let _op = OpGuard::new("open");

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

    let url_str = parsed.as_str().to_string();
    let same_url = HOST_URL
        .lock()
        .get(&host_label)
        .is_some_and(|u| u == &url_str);

    // 常态路径：子 WebView 建过就一直在。同一网址只是停用过 → 只 show，别再导航
    if app.get_webview(&child_label).is_some() {
        let app_main = app.clone();
        let child = child_label.clone();
        let host = host_label.clone();
        let url_for_map = url_str.clone();
        run_on_main_sync(&app, "open-reuse", move || -> Result<(), String> {
            let Some(wv) = app_main.get_webview(&child) else {
                return Err("内嵌网页丢失".into());
            };
            if same_url {
                log_browser(format!("open {child}: show parked {url_for_map}"));
            } else {
                wv.navigate(parsed).map_err(|e| e.to_string())?;
                HOST_URL.lock().insert(host, url_for_map);
            }
            wv.set_bounds(rect).map_err(|e| e.to_string())?;
            wv.show().map_err(|e| e.to_string())?;
            Ok(())
        })??;
        HOST_TO_CHILD
            .lock()
            .insert(host_label.clone(), child_label);
        ACTIVE_HOSTS.lock().insert(host_label);
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

    let _wv = window
        .add_child(builder, rect.position, rect.size)
        .map_err(|e| format!("创建内嵌浏览器失败: {e}"))?;

    let app_main = app.clone();
    let child = child_label.clone();
    run_on_main_sync(&app, "open-create", move || {
        if let Some(wv) = app_main.get_webview(&child) {
            let _ = wv.set_bounds(rect);
        }
    })?;
    HOST_TO_CHILD
        .lock()
        .insert(host_label.clone(), child_label);
    HOST_URL.lock().insert(host_label.clone(), url_str);
    ACTIVE_HOSTS.lock().insert(host_label);
    // 仍持有锁：让新控制器初始化完，别让别的窗口这时候动子 WebView
    std::thread::sleep(std::time::Duration::from_millis(CREATE_SETTLE_MS));
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
        let Some(_guard) = lock_child_ops("set_bounds") else {
            return Ok(());
        };
        let _op = OpGuard::new("set_bounds");
        let host_label = webview.label().to_string();
        // 已停用：窗口收缩动画期间 ResizeObserver 还会狂发 set_bounds，
        // 打到隐藏的子 WebView 控制器上会和 hide 交错，正是卡死触发器之一
        if !ACTIVE_HOSTS.lock().contains(&host_label) {
            return Ok(());
        }
        let child_label = HOST_TO_CHILD
            .lock()
            .get(&host_label)
            .cloned()
            .unwrap_or_else(|| child_label_for_host(&host_label));
        let rect = bounds.to_rect(&webview.window());
        let app_main = app.clone();
        let child = child_label.clone();
        run_on_main_sync(&app, "set_bounds", move || -> Result<(), String> {
            let Some(wv) = app_main.get_webview(&child) else {
                log_browser(format!("set_bounds: {child} not found"));
                return Ok(());
            };
            log_browser(format!("set_bounds {child} -> {rect:?}"));
            wv.set_bounds(rect).map_err(|e| e.to_string())
        })?
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 「关闭」内嵌网页 —— 实际是停用，见 [`park_child_for_host`]
#[tauri::command]
pub async fn browser_close(app: AppHandle, webview: Webview) -> Result<(), String> {
    log_browser(format!("close requested by {}", webview.label()));
    tauri::async_runtime::spawn_blocking(move || {
        let Some(_guard) = lock_child_ops("close") else {
            return;
        };
        let _op = OpGuard::new("close");
        park_child_for_host(&app, webview.label());
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
        let Some(_guard) = lock_child_ops("set_visible") else {
            return Ok(());
        };
        let _op = OpGuard::new("set_visible");
        let host_label = webview.label().to_string();
        let child_label = HOST_TO_CHILD
            .lock()
            .get(&host_label)
            .cloned()
            .unwrap_or_else(|| child_label_for_host(&host_label));
        let Some(wv) = app.get_webview(&child_label) else {
            return Ok(());
        };
        log_browser(format!("set_visible {child_label} -> {visible}"));
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
        let Some(_guard) = lock_child_ops("nav") else {
            return Ok(());
        };
        let _op = OpGuard::new(format!("nav:{action}"));
        let host_label = webview.label().to_string();
        let child_label = HOST_TO_CHILD
            .lock()
            .get(&host_label)
            .cloned()
            .unwrap_or_else(|| child_label_for_host(&host_label));
        let Some(wv) = app.get_webview(&child_label) else {
            return Err("内嵌网页未打开".into());
        };
        log_browser(format!("nav {child_label} action={action}"));
        // 刷新走原生接口；前进/后退没有原生 API，只能注脚本
        match action.as_str() {
            "reload" => wv.reload().map_err(|e| e.to_string()),
            "back" => wv
                .eval("try{history.back()}catch(e){}")
                .map_err(|e| e.to_string()),
            "forward" => wv
                .eval("try{history.forward()}catch(e){}")
                .map_err(|e| e.to_string()),
            _ => Err(format!("未知导航动作: {action}")),
        }
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 前端诊断日志（内嵌浏览器排障用，走宿主终端）
#[tauri::command]
pub fn browser_log(message: String) {
    log_browser(format!("fe: {message}"));
}

/// 是否有网页正开着
///
/// 看的是「停用与否」而不是「子 WebView 在不在」：停用后控制器仍留着复用，
/// 用存在性判断会让首页永远以为还有残留网页。
///
/// 不能写成同步命令：同步命令跑在主线程，而主线程可能正卡在 WebView2 创建里
#[tauri::command]
pub async fn browser_is_open(app: AppHandle, webview: Webview) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let host_label = webview.label().to_string();
        if !ACTIVE_HOSTS.lock().contains(&host_label) {
            return false;
        }
        let child_label = HOST_TO_CHILD
            .lock()
            .get(&host_label)
            .cloned()
            .unwrap_or_else(|| child_label_for_host(&host_label));
        app.get_webview(&child_label).is_some()
    })
    .await
    .unwrap_or(false)
}
