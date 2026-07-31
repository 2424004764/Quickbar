/**
 * 宿主导航磁贴图标（与 Rust host_*_icon 一致）
 * 同步可用，避免「最近使用」先闪字母再出图标
 */

function svgDataUrl(svg) {
  if (typeof btoa === "function") {
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const SETTINGS_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">',
  '<rect width="48" height="48" rx="12" fill="#0078D4"/>',
  '<path fill="#fff" d="M26.9 12.2l.6 2.6a9.8 9.8 0 0 1 2.4 1.4l2.5-.9 2.1 2.1-.9 2.5c.5.7 1 1.5 1.4 2.4l2.6.6v3l-2.6.6c-.4.9-.9 1.7-1.4 2.4l.9 2.5-2.1 2.1-2.5-.9a9.8 9.8 0 0 1-2.4 1.4l-.6 2.6h-3l-.6-2.6a9.8 9.8 0 0 1-2.4-1.4l-2.5.9-2.1-2.1.9-2.5a9.8 9.8 0 0 1-1.4-2.4L12.2 27v-3l2.6-.6c.4-.9.9-1.7 1.4-2.4l-.9-2.5 2.1-2.1 2.5.9c.7-.5 1.5-1 2.4-1.4l.6-2.6h3zM24 19.5A4.5 4.5 0 1 0 24 28.5 4.5 4.5 0 0 0 24 19.5z"/>',
  "</svg>",
].join("");

const MARKET_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">',
  '<rect width="48" height="48" rx="12" fill="#7C3AED"/>',
  '<path fill="#fff" d="M16 18h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V20a2 2 0 0 1 2-2zm2 4v8h12v-8H18zm3-7a3 3 0 0 1 6 0v2h-2v-2a1 1 0 0 0-2 0v2h-2v-2z"/>',
  "</svg>",
].join("");

const LINUX_DO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">',
  '<rect width="48" height="48" rx="12" fill="#FF6A00"/>',
  '<text x="24" y="30" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff">LDO</text>',
  "</svg>",
].join("");

const V2EX_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">',
  '<rect width="48" height="48" rx="12" fill="#1A1A1A"/>',
  '<text x="24" y="30" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="700" fill="#fff">V2</text>',
  "</svg>",
].join("");

/** Windows / Quickbar 设置：蓝底齿轮 */
export const HOST_SETTINGS_ICON_DATA_URL = svgDataUrl(SETTINGS_SVG);

/** 应用市场：紫底商店 */
export const HOST_MARKET_ICON_DATA_URL = svgDataUrl(MARKET_SVG);

/** LINUX DO */
export const HOST_LINUX_DO_ICON_DATA_URL = svgDataUrl(LINUX_DO_SVG);

/** V2EX */
export const HOST_V2EX_ICON_DATA_URL = svgDataUrl(V2EX_SVG);

/**
 * 已知宿主项的同步图标；无则 null
 * @param {{ action?: string, payload?: string, id?: string } | null | undefined} tile
 * @returns {string | null}
 */
export function resolveBuiltinTileIcon(tile) {
  if (!tile) {
    return null;
  }
  const action = tile.action || "";
  const payload = String(tile.payload || "");
  const id = String(tile.id || "");

  if (action === "open_settings" || id === "pin:settings") {
    return HOST_SETTINGS_ICON_DATA_URL;
  }
  if (
    action === "open_market"
    || payload === "market"
    || id === "pin:market"
  ) {
    return HOST_MARKET_ICON_DATA_URL;
  }
  // 系统设置 URI：直接用齿轮，避免等 getAppIcon 时先闪「W」
  if (payload.startsWith("ms-settings:")) {
    return HOST_SETTINGS_ICON_DATA_URL;
  }
  if (
    payload === "https://linux.do/"
    || payload === "https://linux.do"
    || id === "pin:linux-do"
  ) {
    return HOST_LINUX_DO_ICON_DATA_URL;
  }
  if (
    payload === "https://www.v2ex.com/"
    || payload === "https://www.v2ex.com"
    || id === "pin:v2ex"
  ) {
    return HOST_V2EX_ICON_DATA_URL;
  }
  return null;
}

/**
 * @template {object} T
 * @param {T[]} tiles
 * @returns {(T & { iconDataUrl?: string })[]}
 */
export function withBuiltinIcons(tiles) {
  if (!Array.isArray(tiles)) {
    return [];
  }
  return tiles.map((t) => {
    if (t?.iconDataUrl) {
      return t;
    }
    const icon = resolveBuiltinTileIcon(t);
    return icon ? { ...t, iconDataUrl: icon } : t;
  });
}
