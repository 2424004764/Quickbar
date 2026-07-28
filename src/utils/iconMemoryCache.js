/**
 * 进程内图标缓存：最近使用不落盘 dataURL，但会话内记住，避免反复闪字母
 */

/** @type {Map<string, string>} */
const byPath = new Map();

/**
 * @param {string | null | undefined} path
 * @returns {string | null}
 */
export function getCachedAppIcon(path) {
  if (!path) {
    return null;
  }
  return byPath.get(String(path)) || null;
}

/**
 * @param {string | null | undefined} path
 * @param {string | null | undefined} dataUrl
 */
export function setCachedAppIcon(path, dataUrl) {
  if (!path || !dataUrl) {
    return;
  }
  byPath.set(String(path), dataUrl);
}

/**
 * @template {{ payload?: string, iconDataUrl?: string }} T
 * @param {T[]} tiles
 * @returns {T[]}
 */
export function applyMemoryIcons(tiles) {
  if (!Array.isArray(tiles)) {
    return [];
  }
  return tiles.map((t) => {
    if (t?.iconDataUrl || !t?.payload) {
      return t;
    }
    const cached = getCachedAppIcon(t.payload);
    return cached ? { ...t, iconDataUrl: cached } : t;
  });
}
