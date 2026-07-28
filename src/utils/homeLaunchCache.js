/**
 * 首页「常用入口 / 发现插件」会话缓存
 * 进市场会卸载 LaunchHome，回退时用缓存避免先空再刷
 */

/**
 * @typedef {{
 *   pinned: object[],
 *   picks: object[],
 * }} HomeLaunchCacheSnapshot
 */

/** @type {HomeLaunchCacheSnapshot | null} */
let snapshot = null;

/** @returns {HomeLaunchCacheSnapshot | null} */
export function getHomeLaunchCache() {
  return snapshot;
}

/**
 * @param {{ pinned?: object[], picks?: object[] }} partial
 */
export function setHomeLaunchCache(partial) {
  snapshot = {
    pinned: Array.isArray(partial.pinned)
      ? partial.pinned
      : snapshot?.pinned || [],
    picks: Array.isArray(partial.picks)
      ? partial.picks
      : snapshot?.picks || [],
  };
}
