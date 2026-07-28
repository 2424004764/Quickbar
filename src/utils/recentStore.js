/**
 * 最近使用：存在 localStorage，供启动页展示
 */

import { isDeadLaunchTile } from "./deadEntries";
import { setCachedAppIcon } from "./iconMemoryCache";

const KEY = "quickbar.recent.v1";
/** 最近打开最多保留条数 */
export const RECENT_MAX = 60;
const MAX = RECENT_MAX;

/**
 * @typedef {object} RecentTile
 * @property {string} id
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} kind
 * @property {string} action
 * @property {string} payload
 * @property {number} [at]
 * @property {string} [iconDataUrl] 仅内存展示用，不落盘
 */

/**
 * 修正历史错误：把「已安装插件却记成 open_market」改成 open_plugin
 * @param {RecentTile} tile
 * @returns {RecentTile}
 */
export function normalizeRecentTile(tile) {
  if (!tile || typeof tile !== "object") {
    return tile;
  }
  const payload = String(tile.payload || "");
  if (
    tile.action === "open_market"
    && payload
    && payload !== "market"
  ) {
    return {
      ...tile,
      id: `plugin:${payload}`,
      action: "open_plugin",
      kind: "plugin",
    };
  }
  // 市场入口标题历史上写过多种文案，统一为「应用市场」
  if (
    tile.action === "open_market"
    && (tile.id === "pin:market" || payload === "market")
    && tile.title !== "应用市场"
  ) {
    return {
      ...tile,
      id: "pin:market",
      title: "应用市场",
      payload: "market",
    };
  }
  if (tile.action === "noop" && payload) {
    return {
      ...tile,
      id: `plugin:${payload}`,
      action: "open_plugin",
      kind: "plugin",
    };
  }
  if (tile.action === "install_market" && payload) {
    // 已装过的精选项，最近使用应直接打开
    return {
      ...tile,
      id: `plugin:${payload}`,
      action: "open_plugin",
      kind: "plugin",
    };
  }
  return tile;
}

/** @returns {RecentTile[]} */
export function loadRecent() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) {
      return [];
    }
    const normalized = list
      .map(normalizeRecentTile)
      .filter((tile) => !isDeadLaunchTile(tile))
      .slice(0, MAX);
    // 写回纠正/清理后的数据
    try {
      localStorage.setItem(KEY, JSON.stringify(normalized));
    } catch {
      // ignore
    }
    return normalized;
  } catch {
    return [];
  }
}

/**
 * 是否可按 payload 路径拉壳图标（本机应用）
 * @param {RecentTile | { kind?: string, action?: string, payload?: string }} tile
 */
export function isAppPathTile(tile) {
  if (!tile) {
    return false;
  }
  const action = tile.action || "";
  const kind = tile.kind || "";
  const payload = String(tile.payload || "");
  if (!payload) {
    return false;
  }
  return (
    action === "open_path"
    || kind === "app"
  );
}

/** @param {RecentTile} tile */
export function pushRecent(tile) {
  if (!tile?.id) {
    return loadRecent();
  }
  const fixed = normalizeRecentTile(tile);
  if (isDeadLaunchTile(fixed)) {
    return loadRecent();
  }
  // 图标 data URL 体积大，不写 localStorage；会话内存记住，首页首帧可直接用
  const { iconDataUrl, ...persist } = fixed;
  if (iconDataUrl && persist.payload) {
    setCachedAppIcon(persist.payload, iconDataUrl);
  }
  const next = [
    { ...persist, at: Date.now() },
    ...loadRecent().filter((x) => x.id !== fixed.id),
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota
  }
  return next;
}

/**
 * 从使用记录中删除一条
 * @param {string} id
 * @returns {RecentTile[]}
 */
export function removeRecent(id) {
  if (!id) {
    return loadRecent();
  }
  const next = loadRecent().filter((x) => x.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
