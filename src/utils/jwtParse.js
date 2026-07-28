/**
 * JWT 解析（仅解码查看，不做签名校验）
 */

/**
 * @param {string} segment
 * @returns {string}
 */
export function base64UrlToUtf8(segment) {
  const raw = String(segment || "").trim();
  if (!raw) {
    throw new Error("空的 Base64URL 段");
  }
  const padded = raw.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (raw.length % 4)) % 4);
  // atob 在浏览器可用；Node/vitest 用 Buffer 兜底
  let binary;
  if (typeof atob === "function") {
    binary = atob(padded);
  } else if (typeof Buffer !== "undefined") {
    binary = Buffer.from(padded, "base64").toString("binary");
  } else {
    throw new Error("当前环境无法解码 Base64");
  }
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    // 非 UTF-8 时回退 latin1 可见字符，避免整段解析中断
    return binary;
  }
}

/**
 * @param {string} segment
 * @returns {unknown}
 */
export function decodeJwtJsonSegment(segment) {
  const text = base64UrlToUtf8(segment);
  return JSON.parse(text);
}

/**
 * @param {number | undefined | null} seconds
 * @returns {string | null}
 */
export function formatJwtTime(seconds) {
  if (seconds === null || seconds === undefined || seconds === "") {
    return null;
  }
  const n = Number(seconds);
  if (!Number.isFinite(n)) {
    return null;
  }
  const date = new Date(n * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const pad = (v) => String(v).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
  ].join("");
}

/**
 * @param {Record<string, unknown>} payload
 * @param {number} [nowSec]
 */
export function summarizeJwtClaims(payload, nowSec = Math.floor(Date.now() / 1000)) {
  const exp = payload?.exp;
  const nbf = payload?.nbf;
  const iat = payload?.iat;
  /** @type {{ key: string, label: string, value: string, tone?: string }[]} */
  const rows = [];

  if (iat !== undefined) {
    rows.push({
      key: "iat",
      label: "签发时间 (iat)",
      value: formatJwtTime(iat) || String(iat),
    });
  }
  if (nbf !== undefined) {
    const ts = Number(nbf);
    const notYet = Number.isFinite(ts) && nowSec < ts;
    rows.push({
      key: "nbf",
      label: "生效时间 (nbf)",
      value: formatJwtTime(nbf) || String(nbf),
      tone: notYet ? "warn" : undefined,
    });
  }
  if (exp !== undefined) {
    const ts = Number(exp);
    const expired = Number.isFinite(ts) && nowSec >= ts;
    rows.push({
      key: "exp",
      label: "过期时间 (exp)",
      value: formatJwtTime(exp) || String(exp),
      tone: expired ? "danger" : "ok",
    });
    if (Number.isFinite(ts)) {
      const delta = ts - nowSec;
      rows.push({
        key: "ttl",
        label: expired ? "已过期" : "剩余有效",
        value: expired
          ? `${formatDuration(-delta)} 前`
          : formatDuration(delta),
        tone: expired ? "danger" : "ok",
      });
    }
  }

  for (const key of ["iss", "sub", "aud", "jti"]) {
    if (payload?.[key] !== undefined) {
      rows.push({
        key,
        label: key,
        value: formatClaimValue(payload[key]),
      });
    }
  }

  return rows;
}

/**
 * @param {unknown} value
 */
function formatClaimValue(value) {
  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * @param {number} totalSec
 */
export function formatDuration(totalSec) {
  const sec = Math.max(0, Math.floor(Math.abs(totalSec)));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d) {
    parts.push(`${d}天`);
  }
  if (h || d) {
    parts.push(`${h}小时`);
  }
  if (m || h || d) {
    parts.push(`${m}分`);
  }
  parts.push(`${s}秒`);
  return parts.join("");
}

/**
 * 从粘贴文本中提取 JWT（支持 Bearer 前缀、周围空白）
 * @param {string} raw
 */
export function extractJwtToken(raw) {
  let text = String(raw || "").trim();
  if (!text) {
    return "";
  }
  text = text.replace(/^Bearer\s+/i, "").trim();
  // 取第一段看起来像 JWT 的 token
  const match = text.match(
    /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/,
  );
  return match ? match[0] : text;
}

/**
 * @typedef {object} JwtParseResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {string} [token]
 * @property {unknown} [header]
 * @property {unknown} [payload]
 * @property {string} [signature]
 * @property {string} [headerText]
 * @property {string} [payloadText]
 * @property {{ key: string, label: string, value: string, tone?: string }[]} [claims]
 */

/**
 * @param {string} raw
 * @param {number} [nowSec]
 * @returns {JwtParseResult}
 */
export function parseJwt(raw, nowSec = Math.floor(Date.now() / 1000)) {
  const token = extractJwtToken(raw);
  if (!token) {
    return { ok: false, error: "请粘贴 JWT" };
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return { ok: false, error: "JWT 至少应包含 header.payload 两段" };
  }
  if (parts.length > 3) {
    return { ok: false, error: "JWT 段数过多，请检查是否粘贴了多余内容" };
  }

  try {
    const header = decodeJwtJsonSegment(parts[0]);
    const payload = decodeJwtJsonSegment(parts[1]);
    const signature = parts[2] || "";
    const headerText = JSON.stringify(header, null, 2);
    const payloadText = JSON.stringify(payload, null, 2);
    const claims =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? summarizeJwtClaims(/** @type {Record<string, unknown>} */ (payload), nowSec)
        : [];
    return {
      ok: true,
      token,
      header,
      payload,
      signature,
      headerText,
      payloadText,
      claims,
    };
  } catch (err) {
    return {
      ok: false,
      error: `解析失败：${String(err?.message || err)}`,
    };
  }
}
