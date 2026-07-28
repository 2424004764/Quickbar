/**
 * 正则测试：匹配列表 + 替换预览
 */

/**
 * @param {string} pattern
 * @param {string} flags
 * @returns {{ ok: true, regex: RegExp } | { ok: false, error: string }}
 */
export function buildRegex(pattern, flags = "") {
  const p = String(pattern ?? "");
  if (!p) {
    return { ok: false, error: "请输入正则表达式" };
  }
  const f = String(flags ?? "").replace(/[^gimsuy]/gi, "");
  try {
    return { ok: true, regex: new RegExp(p, f) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "正则无效") };
  }
}

/**
 * @param {string} text
 * @param {RegExp} regex
 * @param {number} [limit]
 * @returns {{ index: number, match: string, groups: string[] }[]}
 */
export function listMatches(text, regex, limit = 200) {
  const src = String(text ?? "");
  /** @type {{ index: number, match: string, groups: string[] }[]} */
  const out = [];
  if (!src) {
    return out;
  }
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  let m = re.exec(src);
  let guard = 0;
  while (m && out.length < limit && guard < limit + 5) {
    guard += 1;
    out.push({
      index: m.index,
      match: m[0],
      groups: m.slice(1).map((x) => (x == null ? "" : String(x))),
    });
    if (m[0].length === 0) {
      re.lastIndex += 1;
    }
    m = re.exec(src);
  }
  return out;
}

/**
 * @param {string} text
 * @param {RegExp} regex
 * @param {string} replacement
 * @returns {string}
 */
export function replaceAllPreview(text, regex, replacement) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  return String(text ?? "").replace(re, String(replacement ?? ""));
}
