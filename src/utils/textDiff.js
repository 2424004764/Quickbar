/**
 * 文本行级对比（LCS），产出并排 / 统一 diff 结果
 */

/**
 * @typedef {"same" | "add" | "del" | "empty"} DiffKind
 */

/**
 * @typedef {object} DiffRow
 * @property {DiffKind} kind
 * @property {string} left
 * @property {string} right
 * @property {number | null} leftNo
 * @property {number | null} rightNo
 */

/**
 * @typedef {object} DiffResult
 * @property {DiffRow[]} rows
 * @property {{ same: number, add: number, del: number }} stats
 * @property {string} unified
 */

/**
 * @param {string} text
 * @param {{ trimEnd?: boolean, ignoreWhitespace?: boolean, ignoreCase?: boolean }} [opts]
 */
export function splitLines(text, opts = {}) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.length === 0 ? [] : raw.split("\n");
  // 去掉因末尾换行产生的最后空行展示噪声：保留内容，split 本身已正确
  return lines.map((line) => normalizeLine(line, opts));
}

/**
 * @param {string} line
 * @param {{ trimEnd?: boolean, ignoreWhitespace?: boolean, ignoreCase?: boolean }} [opts]
 */
export function normalizeLine(line, opts = {}) {
  let s = String(line ?? "");
  if (opts.ignoreWhitespace) {
    s = s.replace(/\s+/g, " ").trim();
  } else if (opts.trimEnd) {
    s = s.replace(/[ \t]+$/g, "");
  }
  if (opts.ignoreCase) {
    s = s.toLowerCase();
  }
  return s;
}

/**
 * 原始行（展示用，不做忽略空白/大小写）
 * @param {string} text
 */
export function splitDisplayLines(text) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (raw.length === 0) {
    return [];
  }
  return raw.split("\n");
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Array<{ type: "same"|"add"|"del", aIndex?: number, bIndex?: number }>}
 */
export function diffLineOps(a, b) {
  const n = a.length;
  const m = b.length;
  /** @type {number[][]} */
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  /** @type {Array<{ type: "same"|"add"|"del", aIndex?: number, bIndex?: number }>} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", aIndex: i, bIndex: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", aIndex: i });
      i += 1;
    } else {
      ops.push({ type: "add", bIndex: j });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "del", aIndex: i });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "add", bIndex: j });
    j += 1;
  }
  return ops;
}

/**
 * @param {string} leftText
 * @param {string} rightText
 * @param {{ ignoreWhitespace?: boolean, ignoreCase?: boolean, trimEnd?: boolean }} [opts]
 * @returns {DiffResult}
 */
export function diffTexts(leftText, rightText, opts = {}) {
  const leftDisplay = splitDisplayLines(leftText);
  const rightDisplay = splitDisplayLines(rightText);
  const leftNorm = leftDisplay.map((line) => normalizeLine(line, opts));
  const rightNorm = rightDisplay.map((line) => normalizeLine(line, opts));
  const ops = diffLineOps(leftNorm, rightNorm);

  /** @type {DiffRow[]} */
  const rows = [];
  const stats = { same: 0, add: 0, del: 0 };
  /** @type {string[]} */
  const unified = [];

  for (const op of ops) {
    if (op.type === "same") {
      const leftNo = (op.aIndex ?? 0) + 1;
      const rightNo = (op.bIndex ?? 0) + 1;
      const text = leftDisplay[op.aIndex ?? 0] ?? "";
      rows.push({
        kind: "same",
        left: text,
        right: rightDisplay[op.bIndex ?? 0] ?? text,
        leftNo,
        rightNo,
      });
      stats.same += 1;
      unified.push(` ${text}`);
    } else if (op.type === "del") {
      const leftNo = (op.aIndex ?? 0) + 1;
      const text = leftDisplay[op.aIndex ?? 0] ?? "";
      rows.push({
        kind: "del",
        left: text,
        right: "",
        leftNo,
        rightNo: null,
      });
      stats.del += 1;
      unified.push(`-${text}`);
    } else {
      const rightNo = (op.bIndex ?? 0) + 1;
      const text = rightDisplay[op.bIndex ?? 0] ?? "";
      rows.push({
        kind: "add",
        left: "",
        right: text,
        leftNo: null,
        rightNo,
      });
      stats.add += 1;
      unified.push(`+${text}`);
    }
  }

  return {
    rows,
    stats,
    unified: unified.join("\n"),
  };
}

/**
 * 是否完全一致（按当前规范化选项）
 * @param {string} leftText
 * @param {string} rightText
 * @param {{ ignoreWhitespace?: boolean, ignoreCase?: boolean, trimEnd?: boolean }} [opts]
 */
export function textsEqual(leftText, rightText, opts = {}) {
  const a = splitDisplayLines(leftText).map((l) => normalizeLine(l, opts));
  const b = splitDisplayLines(rightText).map((l) => normalizeLine(l, opts));
  if (a.length !== b.length) {
    return false;
  }
  return a.every((line, i) => line === b[i]);
}
