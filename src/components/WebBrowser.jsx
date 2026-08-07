/**
 * 内嵌网页顶栏；真正的页面由 Rust 子 WebView 盖在 content 区域上
 * 支持分离为独立窗口（与插件工具一致）
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  browserClose,
  browserCloseNow,
  browserIsOpen,
  browserNav,
  browserOpen,
  browserSetBounds,
  browserSetVisible,
  hideMainWindow,
  openPath,
} from "../pluginApi/api";
import { openDetachedWebWindow } from "../utils/webWindow";
import {
  handleWindowDragMouseDown,
  setBlurHidePinned,
} from "../utils/windowDrag";

/**
 * @param {{
 *   url: string,
 *   title?: string,
 *   detached?: boolean,
 *   onBack: () => void,
 *   onDetached?: () => void,
 * }} props
 */
export function WebBrowser({
  url,
  title,
  detached = false,
  onBack,
  onDetached,
}) {
  const contentRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const menuRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  // 子 WebView 一获焦，宿主 WebView 就算失焦，会触发「失焦隐藏」把启动器藏掉；
  // 浏览期间钉住窗口（Rust + 前端两条路径都关），退出时恢复
  useEffect(() => {
    if (detached) {
      return undefined;
    }
    void setBlurHidePinned(true);
    return () => {
      void setBlurHidePinned(false);
    };
  }, [detached]);

  /** 网页是原生子 WebView，会盖住 HTML 浮层，开菜单时先把它藏起来 */
  function toggleMenu(next) {
    setMenuOpen(next);
    void browserSetVisible(!next);
  }

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    function onDocClick(e) {
      if (!menuRef.current?.contains(e.target)) {
        toggleMenu(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  // 焦点在网页里时宿主收不到按键，由 Rust 侧的导航桥把 Esc / Ctrl+D 转成事件送回来
  const keyActionRef = useRef(() => {});
  keyActionRef.current = (action) => {
    if (action === "detach") {
      if (!detached) {
        void handleDetach();
      }
      return;
    }
    if (action !== "esc") {
      return;
    }
    if (detached) {
      void getCurrentWindow().close();
      return;
    }
    onBack?.();
  };

  useEffect(() => {
    let unlisten;
    let disposed = false;
    (async () => {
      const fn = await listen("quickbar://browser-key", (event) => {
        keyActionRef.current?.(event.payload);
      });
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    })().catch((err) => {
      console.error("listen browser key failed", err);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  /** 带上视口尺寸，由 Rust 按「窗口物理宽 ÷ 视口宽」换算，避开 DPI 缩放的坑 */
  function readBounds() {
    const el = contentRef.current;
    if (!el) {
      return null;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) {
      return null;
    }
    return {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }

  useLayoutEffect(() => {
    let cancelled = false;
    let ro;

    async function sync(openUrl) {
      const bounds = readBounds();
      if (!bounds || cancelled) {
        return;
      }
      try {
        if (openUrl) {
          await browserOpen(openUrl, bounds);
        } else {
          await browserSetBounds(bounds);
        }
      } catch (err) {
        console.error("in-app browser:", err);
      }
    }

    void sync(url);

    const el = contentRef.current;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        void sync(null);
      });
      ro.observe(el);
    }

    function onWinResize() {
      void sync(null);
    }
    window.addEventListener("resize", onWinResize);

    // 自愈：窗口重新唤起时子页面若已不在（被清理 / 上一轮残留被关掉），重开一次
    let unlistenShown;
    (async () => {
      const fn = await listen("quickbar://window-shown", () => {
        void (async () => {
          if (cancelled) {
            return;
          }
          const alive = await browserIsOpen().catch(() => false);
          await sync(alive ? null : url);
        })();
      });
      if (cancelled) {
        fn();
        return;
      }
      unlistenShown = fn;
    })().catch(() => {});

    return () => {
      cancelled = true;
      ro?.disconnect();
      unlistenShown?.();
      window.removeEventListener("resize", onWinResize);
      void browserClose();
    };
  }, [url]);

  async function handleDetach() {
    toggleMenu(false);
    try {
      // 先停用主窗的子页面：新窗口的 WebView 创建同样在主线程，两者重叠会卡死
      await browserCloseNow();
      await openDetachedWebWindow(url, title || url);
      onDetached?.();
    } catch (err) {
      console.error("detach web failed", err);
    }
  }

  async function handleTogglePin() {
    try {
      const win = getCurrentWindow();
      const next = !pinned;
      await win.setAlwaysOnTop(next);
      setPinned(next);
    } catch (err) {
      console.error("pin failed", err);
    }
  }

  async function handleExitBackground() {
    toggleMenu(false);
    if (detached) {
      await getCurrentWindow().minimize();
      return;
    }
    await hideMainWindow();
  }

  function handleEnd() {
    toggleMenu(false);
    if (detached) {
      void getCurrentWindow().close();
      return;
    }
    onBack?.();
  }

  const displayTitle = title || url;

  return (
    <div className={["wb-shell", detached ? "is-detached" : ""].join(" ")}>
      <header
        className="wb-topbar is-drag-region"
        onMouseDown={handleWindowDragMouseDown}
      >
        {!detached ? (
          <button
            type="button"
            className="btn ghost"
            data-no-drag
            onClick={onBack}
          >
            ← 返回
          </button>
        ) : null}
        <div className="wb-title" title={displayTitle}>
          {displayTitle}
        </div>
        <div className="wb-nav" data-no-drag>
          <button
            type="button"
            className="btn wb-nav-btn"
            title="上一页"
            onClick={() => void browserNav("back")}
          >
            上一页
          </button>
          <button
            type="button"
            className="btn wb-nav-btn"
            title="下一页"
            onClick={() => void browserNav("forward")}
          >
            下一页
          </button>
          <button
            type="button"
            className="btn wb-nav-btn"
            title="刷新"
            onClick={() => void browserNav("reload")}
          >
            刷新
          </button>
        </div>
        <div className="wb-header-actions" data-no-drag>
          <button
            type="button"
            className="btn"
            title="用系统浏览器打开"
            onClick={() => void openPath(url)}
          >
            外部打开
          </button>
          {detached ? (
            <button
              type="button"
              className={["btn", "wb-pin-btn", pinned ? "is-on" : ""].join(" ")}
              title={pinned ? "取消置顶" : "窗口置顶"}
              onClick={() => void handleTogglePin()}
            >
              {pinned ? "已置顶" : "置顶"}
            </button>
          ) : (
            <button
              id="qb-detach-btn"
              type="button"
              className="btn"
              title="分离为独立窗口 Ctrl+D"
              onClick={() => void handleDetach()}
            >
              分离窗口
            </button>
          )}
          <div className="wb-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="btn"
              aria-label="更多"
              onClick={() => toggleMenu(!menuOpen)}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="wb-menu">
                {detached ? (
                  <button
                    type="button"
                    className="wb-menu-item"
                    onClick={() => void handleTogglePin()}
                  >
                    <span>{pinned ? "取消置顶" : "窗口置顶"}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="wb-menu-item"
                    onClick={() => void handleDetach()}
                  >
                    <span>分离为独立窗口</span>
                    <kbd>Ctrl+D</kbd>
                  </button>
                )}
                <div className="wb-menu-sep" />
                <button
                  type="button"
                  className="wb-menu-item"
                  onClick={() => void handleExitBackground()}
                >
                  <span>{detached ? "最小化" : "退出到后台"}</span>
                </button>
                <button
                  type="button"
                  className="wb-menu-item danger"
                  onClick={handleEnd}
                >
                  <span>{detached ? "关闭窗口" : "结束并返回"}</span>
                  <kbd>Esc</kbd>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <div
        ref={contentRef}
        className="wb-content"
        aria-label="网页内容区"
      />
      <footer className="wb-foot">
        {detached
          ? "Esc 关闭窗口 · 可置顶"
          : "Esc 关闭网页 · Ctrl+D 分离窗口"}
      </footer>
    </div>
  );
}
