/**
 * 主窗逻辑尺寸：首页收紧/按最近行数加高、搜索列表、设置/插件/市场
 */
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

/** 首页（最近一行收起） */
export const HOME_COMPACT_SIZE = { width: 720, height: 430 };
/** 与 `.lp-tile` 行高大致对齐，用于按行加高窗口 */
export const HOME_RECENT_ROW_PX = 83;
/** 展开后「最近」最多露出行数，超出在面板内滚动 */
export const HOME_RECENT_MAX_VISIBLE_ROWS = 4;

/**
 * 按「最近打开」行数计算展开后窗口高度（多出来的行才加高，避免底部空段）
 * @param {number} totalRows 展开后总行数（含第一行）
 */
export function homeSizeForRecentExpand(totalRows) {
  const rows = Math.max(
    1,
    Math.min(Number(totalRows) || 1, HOME_RECENT_MAX_VISIBLE_ROWS),
  );
  const extra = (rows - 1) * HOME_RECENT_ROW_PX;
  return {
    width: HOME_COMPACT_SIZE.width,
    height: HOME_COMPACT_SIZE.height + extra,
  };
}

/** 搜索结果列表 */
export const SEARCH_SIZE = { width: 720, height: 480 };
/** 设置 / 内嵌插件等需要更高内容区 */
export const PANEL_SIZE = { width: 720, height: 540 };
/** 应用市场：列表项多，单独加高 */
export const MARKET_SIZE = { width: 720, height: 640 };
/** 内嵌网页 */
export const BROWSER_SIZE = { width: 900, height: 640 };

/** @type {string | null} */
let lastAppliedKey = null;
/** @type {number} */
let animToken = 0;
/** @type {number | null} */
let animFrameId = null;

function sizeKey(size) {
  return `${size.width}x${size.height}`;
}

function cancelSizeAnimation() {
  animToken += 1;
  if (animFrameId != null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

/** ease-out cubic */
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/**
 * 按主界面视图解析目标尺寸（与 App 导航一致，供点击时抢先 setSize）
 * @param {"search"|"market"|"settings"|"plugin"|"browser"} view
 * @param {{ showHome?: boolean, homeRecentExpanded?: boolean, homeRecentExpandRows?: number }} [opts]
 */
export function resolveMainWindowSize(view, opts = {}) {
  if (view === "market") {
    return MARKET_SIZE;
  }
  if (view === "browser") {
    return BROWSER_SIZE;
  }
  if (view === "settings" || view === "plugin") {
    return PANEL_SIZE;
  }
  if (view !== "search") {
    return HOME_COMPACT_SIZE;
  }
  if (!opts.showHome) {
    return SEARCH_SIZE;
  }
  if (opts.homeRecentExpanded) {
    return homeSizeForRecentExpand(opts.homeRecentExpandRows);
  }
  return HOME_COMPACT_SIZE;
}

/**
 * 立即设置尺寸（取消进行中的动画）
 * @param {{ width: number, height: number }} size
 * @returns {Promise<void>}
 */
export function applyMainWindowSize(size) {
  if (!size?.width || !size?.height) {
    return Promise.resolve();
  }
  cancelSizeAnimation();
  const key = sizeKey(size);
  if (key === lastAppliedKey) {
    return Promise.resolve();
  }
  lastAppliedKey = key;
  try {
    const win = getCurrentWindow();
    return win.setSize(new LogicalSize(size.width, size.height)).catch((err) => {
      if (lastAppliedKey === key) {
        lastAppliedKey = null;
      }
      console.error("set window size failed", err);
    });
  } catch (err) {
    lastAppliedKey = null;
    console.error("set window size failed", err);
    return Promise.resolve();
  }
}

/**
 * 缓动过渡到目标尺寸（首页 ↔ 市场高低切换用）
 * @param {{ width: number, height: number }} size
 * @param {{ durationMs?: number }} [opts]
 * @returns {Promise<void>}
 */
export async function animateMainWindowSize(size, opts = {}) {
  if (!size?.width || !size?.height) {
    return;
  }
  const key = sizeKey(size);
  if (key === lastAppliedKey) {
    return;
  }

  cancelSizeAnimation();
  const token = animToken;
  const durationMs = Math.max(80, Number(opts.durationMs) || 200);

  try {
    const win = getCurrentWindow();
    const [inner, scale] = await Promise.all([
      win.innerSize(),
      win.scaleFactor(),
    ]);
    if (token !== animToken) {
      return;
    }

    const fromW = inner.width / scale;
    const fromH = inner.height / scale;
    const toW = size.width;
    const toH = size.height;

    if (Math.abs(fromW - toW) < 1.5 && Math.abs(fromH - toH) < 1.5) {
      lastAppliedKey = key;
      return;
    }

    const start = performance.now();
    let lastH = Math.round(fromH);
    let lastW = Math.round(fromW);

    await new Promise((resolve) => {
      const step = (now) => {
        if (token !== animToken) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / durationMs);
        const e = easeOutCubic(t);
        const w = Math.round(fromW + (toW - fromW) * e);
        const h = Math.round(fromH + (toH - fromH) * e);
        // 高度未变则跳过 IPC，减轻 Windows 上频繁 setSize 的负担
        if (w !== lastW || h !== lastH || t >= 1) {
          lastW = w;
          lastH = h;
          void win.setSize(new LogicalSize(w, h)).catch(() => {});
        }
        if (t < 1) {
          animFrameId = requestAnimationFrame(step);
          return;
        }
        animFrameId = null;
        lastAppliedKey = key;
        void win.setSize(new LogicalSize(toW, toH)).catch(() => {});
        resolve();
      };
      animFrameId = requestAnimationFrame(step);
    });
  } catch (err) {
    console.error("animate window size failed", err);
    // 退化：直接落到目标
    lastAppliedKey = null;
    await applyMainWindowSize(size);
  }
}
