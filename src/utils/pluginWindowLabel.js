/**
 * 独立插件窗 label 生成（纯函数；capabilities 匹配 plugin-*）
 */

/**
 * @param {string} pluginId
 * @param {number} seq
 * @param {number} [now]
 * @returns {string}
 */
export function makePluginWindowLabel(pluginId, seq, now = Date.now()) {
  const safeId = String(pluginId).replace(/[^a-zA-Z0-9_-]/g, "-");
  return `plugin-${safeId}-${now}-${seq}`;
}

/**
 * 多窗口错开像素偏移
 * @param {number} seq 从 1 起
 * @returns {number}
 */
export function detachWindowOffset(seq) {
  return ((Math.max(1, seq) - 1) % 8) * 28;
}
