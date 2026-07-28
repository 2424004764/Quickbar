/**
 * UUID / 短 ID 生成（本地，无依赖）
 */

/**
 * @returns {string} RFC4122 v4
 */
export function randomUuidV4() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * @param {number} [bytes]
 * @returns {string} 十六进制短 ID
 */
export function randomShortId(bytes = 8) {
  const n = Math.min(32, Math.max(2, Math.floor(Number(bytes) || 8)));
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {number} count
 * @param {"uuid" | "short"} kind
 * @param {number} [shortBytes]
 * @returns {string[]}
 */
export function generateIds(count, kind = "uuid", shortBytes = 8) {
  const n = Math.min(100, Math.max(1, Math.floor(Number(count) || 1)));
  /** @type {string[]} */
  const list = [];
  for (let i = 0; i < n; i += 1) {
    list.push(kind === "short" ? randomShortId(shortBytes) : randomUuidV4());
  }
  return list;
}
