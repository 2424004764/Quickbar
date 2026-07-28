/**
 * 时间戳 ↔ 日期时间转换（秒 / 毫秒自动识别）
 */

/**
 * @typedef {"s" | "ms" | "auto"} TimestampUnit
 */

/**
 * @typedef {object} TimestampParseResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} [ms]
 * @property {number} [sec]
 * @property {"s" | "ms"} [detectedUnit]
 * @property {string} [iso]
 * @property {string} [utc]
 * @property {string} [local]
 * @property {string} [relative]
 */

/**
 * @typedef {object} DateTimeParseResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} [ms]
 * @property {number} [sec]
 * @property {string} [iso]
 * @property {string} [utc]
 * @property {string} [local]
 */

const PAD2 = (n) => String(n).padStart(2, "0");
const PAD3 = (n) => String(n).padStart(3, "0");

/**
 * 格式化为本地 YYYY-MM-DD HH:mm:ss.SSS
 * @param {Date} date
 */
export function formatLocalDateTime(date) {
  return [
    `${date.getFullYear()}-${PAD2(date.getMonth() + 1)}-${PAD2(date.getDate())}`,
    `${PAD2(date.getHours())}:${PAD2(date.getMinutes())}:${PAD2(date.getSeconds())}.${PAD3(date.getMilliseconds())}`,
  ].join(" ");
}

/**
 * 格式化为 UTC YYYY-MM-DD HH:mm:ss.SSS
 * @param {Date} date
 */
export function formatUtcDateTime(date) {
  return [
    `${date.getUTCFullYear()}-${PAD2(date.getUTCMonth() + 1)}-${PAD2(date.getUTCDate())}`,
    `${PAD2(date.getUTCHours())}:${PAD2(date.getUTCMinutes())}:${PAD2(date.getUTCSeconds())}.${PAD3(date.getUTCMilliseconds())}`,
  ].join(" ");
}

/**
 * 相对当前时间的中文描述
 * @param {number} ms
 * @param {number} [nowMs]
 */
export function formatRelative(ms, nowMs = Date.now()) {
  const diff = ms - nowMs;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "后" : "前";
  if (abs < 1000) {
    return "刚刚";
  }
  const sec = Math.floor(abs / 1000);
  if (sec < 60) {
    return `${sec} 秒${suffix}`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min} 分钟${suffix}`;
  }
  const hour = Math.floor(min / 60);
  if (hour < 24) {
    return `${hour} 小时${suffix}`;
  }
  const day = Math.floor(hour / 24);
  if (day < 30) {
    return `${day} 天${suffix}`;
  }
  const month = Math.floor(day / 30);
  if (month < 12) {
    return `${month} 个月${suffix}`;
  }
  const year = Math.floor(day / 365);
  return `${year} 年${suffix}`;
}

/**
 * 根据数值推断单位：>= 1e12 视为毫秒，否则秒
 * @param {number} value
 * @returns {"s" | "ms"}
 */
export function detectTimestampUnit(value) {
  const abs = Math.abs(value);
  if (abs >= 1e12) {
    return "ms";
  }
  return "s";
}

/**
 * 解析时间戳输入
 * @param {string | number} input
 * @param {TimestampUnit} [unit]
 * @param {number} [nowMs]
 * @returns {TimestampParseResult}
 */
export function parseTimestamp(input, unit = "auto", nowMs = Date.now()) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { ok: false, error: "请输入时间戳" };
  }
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    return { ok: false, error: "时间戳须为数字（支持小数）" };
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return { ok: false, error: "无效数字" };
  }

  /** @type {"s" | "ms"} */
  let detected;
  if (unit === "auto") {
    detected = detectTimestampUnit(num);
  } else {
    detected = unit;
  }

  const ms = detected === "ms" ? num : num * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: "无法解析为有效时间" };
  }

  return {
    ok: true,
    ms: Math.trunc(ms),
    sec: Math.trunc(ms / 1000),
    detectedUnit: detected,
    iso: date.toISOString(),
    utc: formatUtcDateTime(date),
    local: formatLocalDateTime(date),
    relative: formatRelative(ms, nowMs),
  };
}

/**
 * 解析日期时间字符串为时间戳
 * 支持：ISO、YYYY-MM-DD HH:mm:ss、YYYY/MM/DD、以及 Date 可解析的常见格式
 * @param {string} input
 * @returns {DateTimeParseResult}
 */
export function parseDateTime(input) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { ok: false, error: "请输入日期时间" };
  }

  let date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    // 兼容 "YYYY-MM-DD HH:mm:ss" / "YYYY/MM/DD HH:mm:ss"
    const m = raw.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?$/,
    );
    if (!m) {
      return { ok: false, error: "无法识别的日期格式" };
    }
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const h = Number(m[4] ?? 0);
    const mi = Number(m[5] ?? 0);
    const s = Number(m[6] ?? 0);
    const msPart = m[7] ? Number(m[7].padEnd(3, "0")) : 0;
    date = new Date(y, mo, d, h, mi, s, msPart);
  }

  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: "无效日期时间" };
  }

  const ms = date.getTime();
  return {
    ok: true,
    ms,
    sec: Math.trunc(ms / 1000),
    iso: date.toISOString(),
    utc: formatUtcDateTime(date),
    local: formatLocalDateTime(date),
  };
}

/**
 * 当前时刻的秒 / 毫秒时间戳
 * @param {number} [nowMs]
 */
export function nowTimestamps(nowMs = Date.now()) {
  return {
    ms: Math.trunc(nowMs),
    sec: Math.trunc(nowMs / 1000),
  };
}
