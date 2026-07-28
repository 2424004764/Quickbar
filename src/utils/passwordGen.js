/**
 * 随机密码生成（crypto.getRandomValues）
 */

export const CHARSET_LOWER = "abcdefghijklmnopqrstuvwxyz";
export const CHARSET_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const CHARSET_DIGIT = "0123456789";
export const CHARSET_SYMBOL = "!@#$%^&*()-_=+[]{};:,.?/";

/** 易混淆字符：0 O o I l 1 | */
export const AMBIGUOUS = "0OoIl1|";

/**
 * @typedef {object} PasswordOptions
 * @property {number} length
 * @property {boolean} lower
 * @property {boolean} upper
 * @property {boolean} digit
 * @property {boolean} symbol
 * @property {boolean} [excludeAmbiguous]
 */

/**
 * @typedef {object} PasswordResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {string} [password]
 * @property {number} [entropyBits]
 * @property {"weak" | "fair" | "strong" | "very-strong"} [strength]
 */

/**
 * @param {PasswordOptions} opts
 */
export function buildCharset(opts) {
  let set = "";
  if (opts.lower) set += CHARSET_LOWER;
  if (opts.upper) set += CHARSET_UPPER;
  if (opts.digit) set += CHARSET_DIGIT;
  if (opts.symbol) set += CHARSET_SYMBOL;
  if (opts.excludeAmbiguous) {
    set = [...set].filter((ch) => !AMBIGUOUS.includes(ch)).join("");
  }
  // 去重保序
  return [...new Set(set)].join("");
}

/**
 * 均匀随机整数 [0, max)
 * @param {number} max
 * @param {() => number} [randomByte] 0–255，便于测试注入
 */
export function randomInt(max, randomByte = defaultRandomByte) {
  if (max <= 0) {
    throw new Error("max must be > 0");
  }
  // 拒绝采样，避免取模偏差
  const limit = 256 - (256 % max);
  let x = randomByte();
  while (x >= limit) {
    x = randomByte();
  }
  return x % max;
}

function defaultRandomByte() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }
  return Math.floor(Math.random() * 256);
}

/**
 * @param {PasswordOptions} opts
 * @param {() => number} [randomByte]
 * @returns {PasswordResult}
 */
export function generatePassword(opts, randomByte = defaultRandomByte) {
  const length = Math.trunc(Number(opts.length));
  if (!Number.isFinite(length) || length < 4 || length > 128) {
    return { ok: false, error: "长度须在 4–128 之间" };
  }
  if (!opts.lower && !opts.upper && !opts.digit && !opts.symbol) {
    return { ok: false, error: "至少勾选一种字符类型" };
  }

  /** @type {string[]} */
  const pools = [];
  if (opts.lower) {
    pools.push(
      filterAmbiguous(CHARSET_LOWER, opts.excludeAmbiguous),
    );
  }
  if (opts.upper) {
    pools.push(
      filterAmbiguous(CHARSET_UPPER, opts.excludeAmbiguous),
    );
  }
  if (opts.digit) {
    pools.push(
      filterAmbiguous(CHARSET_DIGIT, opts.excludeAmbiguous),
    );
  }
  if (opts.symbol) {
    pools.push(
      filterAmbiguous(CHARSET_SYMBOL, opts.excludeAmbiguous),
    );
  }
  if (pools.some((p) => p.length === 0)) {
    return { ok: false, error: "排除易混淆后字符集为空，请放宽选项" };
  }

  const charset = buildCharset(opts);
  if (!charset) {
    return { ok: false, error: "字符集为空" };
  }
  if (length < pools.length) {
    return {
      ok: false,
      error: `长度至少为 ${pools.length}，才能覆盖已选字符类型`,
    };
  }

  /** @type {string[]} */
  const chars = [];
  // 保证每类至少 1 个
  for (const pool of pools) {
    chars.push(pool[randomInt(pool.length, randomByte)]);
  }
  while (chars.length < length) {
    chars.push(charset[randomInt(charset.length, randomByte)]);
  }
  // Fisher–Yates 打乱
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1, randomByte);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  const password = chars.join("");
  const entropyBits = estimateEntropyBits(length, charset.length);
  return {
    ok: true,
    password,
    entropyBits,
    strength: strengthFromEntropy(entropyBits),
  };
}

/**
 * @param {string} set
 * @param {boolean} [exclude]
 */
function filterAmbiguous(set, exclude) {
  if (!exclude) {
    return set;
  }
  return [...set].filter((ch) => !AMBIGUOUS.includes(ch)).join("");
}

/**
 * @param {number} length
 * @param {number} charsetSize
 */
export function estimateEntropyBits(length, charsetSize) {
  if (length <= 0 || charsetSize <= 1) {
    return 0;
  }
  return Math.round(length * Math.log2(charsetSize) * 10) / 10;
}

/**
 * @param {number} bits
 * @returns {"weak" | "fair" | "strong" | "very-strong"}
 */
export function strengthFromEntropy(bits) {
  if (bits < 40) return "weak";
  if (bits < 60) return "fair";
  if (bits < 80) return "strong";
  return "very-strong";
}

export const STRENGTH_LABEL = {
  weak: "弱",
  fair: "一般",
  strong: "强",
  "very-strong": "很强",
};

/**
 * @param {PasswordOptions} opts
 * @param {number} count
 * @param {() => number} [randomByte]
 */
export function generatePasswords(opts, count = 1, randomByte = defaultRandomByte) {
  const n = Math.min(20, Math.max(1, Math.trunc(count)));
  /** @type {PasswordResult[]} */
  const list = [];
  for (let i = 0; i < n; i += 1) {
    list.push(generatePassword(opts, randomByte));
  }
  return list;
}
