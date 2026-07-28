/**
 * 首页磁贴颜色：按业务 id 稳定映射，避免「最近使用 / 已固定 / 市场」同名不同色
 */

/** @type {readonly string[]} */
export const TILE_TONES = ["blue", "teal", "violet", "rose", "amber"];

/**
 * 已知入口固定色（不必参与哈希）
 * @type {Record<string, string>}
 */
const FIXED_TONE_BY_KEY = {
  market: "blue",
  "pin:market": "blue",
};

/**
 * 从 tile id / payload 抽出稳定业务键
 * @param {string} [id]
 * @param {string} [payload]
 */
export function tileToneKey(id = "", payload = "") {
  const raw = String(payload || id || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw === "market" || raw === "pin:market") {
    return "market";
  }
  // plugin:json-format / plugin-cmd:json-format:x → json-format
  const plugin = raw.match(/^plugin(?:-cmd)?:([^:]+)/);
  if (plugin?.[1]) {
    return plugin[1];
  }
  // pin:cmd:xxx → cmd:xxx
  if (raw.startsWith("pin:cmd:")) {
    return raw.slice("pin:".length);
  }
  if (raw.startsWith("pin:")) {
    return raw.slice(4);
  }
  return raw;
}

/**
 * @param {string} key
 */
function hashToneIndex(key) {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % TILE_TONES.length;
}

/**
 * @param {{ id?: string, payload?: string, kind?: string }} tile
 * @returns {string}
 */
export function toneForTile(tile) {
  const key = tileToneKey(tile?.id, tile?.payload);
  if (!key) {
    return TILE_TONES[0];
  }
  if (FIXED_TONE_BY_KEY[key]) {
    return FIXED_TONE_BY_KEY[key];
  }
  return TILE_TONES[hashToneIndex(key)];
}
