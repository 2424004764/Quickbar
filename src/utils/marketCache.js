/**
 * 市场列表会话缓存：首页预取后进市场可立刻渲染，避免整页「加载中」闪白
 */

/**
 * @typedef {{
 *   marketItems: object[],
 *   installed: object[],
 *   marketBaseUrl: string,
 * }} MarketCacheSnapshot
 */

/** @type {MarketCacheSnapshot | null} */
let snapshot = null;

/** @returns {MarketCacheSnapshot | null} */
export function getMarketCache() {
  return snapshot;
}

/**
 * @param {{
 *   marketItems?: object[],
 *   installed?: object[],
 *   marketBaseUrl?: string,
 * }} partial
 */
export function setMarketCache(partial) {
  snapshot = {
    marketItems: Array.isArray(partial.marketItems)
      ? partial.marketItems
      : snapshot?.marketItems || [],
    installed: Array.isArray(partial.installed)
      ? partial.installed
      : snapshot?.installed || [],
    marketBaseUrl:
      partial.marketBaseUrl !== undefined
        ? String(partial.marketBaseUrl || "").trim()
        : snapshot?.marketBaseUrl || "",
  };
}

export function clearMarketCache() {
  snapshot = null;
}
