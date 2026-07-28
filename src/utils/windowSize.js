/**
 * 主窗逻辑尺寸：首页收紧/按最近行数加高、搜索列表、设置/插件；市场与进入前同高
 */
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

/** 首页（最近一行收起） */
export const HOME_COMPACT_SIZE = { width: 720, height: 390 };
/** 与 `.lp-tile` 行高大致对齐，用于按行加高窗口 */
export const HOME_RECENT_ROW_PX = 70;
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

/**
 * @param {{ width: number, height: number }} size
 */
export async function applyMainWindowSize(size) {
  if (!size?.width || !size?.height) {
    return;
  }
  try {
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(size.width, size.height));
  } catch (err) {
    console.error("set window size failed", err);
  }
}
