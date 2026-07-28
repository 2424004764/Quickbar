/**
 * Base64 编解码（UTF-8；可选 URL-safe）
 */

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
function utf8Bytes(text) {
  return new TextEncoder().encode(String(text ?? ""));
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBinary(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

/**
 * @param {string} binary
 * @returns {Uint8Array}
 */
function binaryToBytes(binary) {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * @param {string} text
 * @param {{ urlSafe?: boolean }} [opts]
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function encodeBase64(text, opts = {}) {
  try {
    const b64 = btoa(bytesToBinary(utf8Bytes(text)));
    const value = opts.urlSafe
      ? b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
      : b64;
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "编码失败") };
  }
}

/**
 * @param {string} input
 * @param {{ urlSafe?: boolean }} [opts]
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function decodeBase64(input, opts = {}) {
  const raw = String(input ?? "").trim().replace(/\s+/g, "");
  if (!raw) {
    return { ok: false, error: "请输入 Base64 文本" };
  }
  try {
    let b64 = raw;
    if (opts.urlSafe || /[-_]/.test(raw)) {
      b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    }
    const pad = b64.length % 4;
    if (pad) {
      b64 += "=".repeat(4 - pad);
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
      return { ok: false, error: "不是有效的 Base64" };
    }
    const value = bytesToUtf8(binaryToBytes(atob(b64)));
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "解码失败") };
  }
}
