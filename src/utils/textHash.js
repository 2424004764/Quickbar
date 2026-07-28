/**
 * 文本摘要：MD5（纯 JS）+ SHA-1 / SHA-256（Web Crypto）
 */
import { md5Hex } from "./md5";

/**
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
function bufferToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * @param {string} text
 * @returns {string}
 */
export function hashMd5(text) {
  return md5Hex(text);
}

/**
 * @param {string} text
 * @param {"SHA-1" | "SHA-256"} algo
 * @returns {Promise<string>}
 */
export async function hashSubtle(text, algo) {
  const data = new TextEncoder().encode(String(text ?? ""));
  const digest = await crypto.subtle.digest(algo, data);
  return bufferToHex(digest);
}

/**
 * @param {string} text
 * @returns {Promise<{
 *   ok: true,
 *   md5: string,
 *   sha1: string,
 *   sha256: string,
 * } | { ok: false, error: string }>}
 */
export async function hashTextAll(text) {
  try {
    const [sha1, sha256] = await Promise.all([
      hashSubtle(text, "SHA-1"),
      hashSubtle(text, "SHA-256"),
    ]);
    return {
      ok: true,
      md5: hashMd5(text),
      sha1,
      sha256,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "计算失败") };
  }
}
