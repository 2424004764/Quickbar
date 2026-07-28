/**
 * URL 编解码：component（默认）或完整 URI
 */

/**
 * @param {string} text
 * @param {"component" | "uri"} [mode]
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function encodeUrl(text, mode = "component") {
  try {
    const value =
      mode === "uri"
        ? encodeURI(String(text ?? ""))
        : encodeURIComponent(String(text ?? ""));
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "编码失败") };
  }
}

/**
 * @param {string} text
 * @param {"component" | "uri"} [mode]
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function decodeUrl(text, mode = "component") {
  const raw = String(text ?? "");
  if (!raw.trim()) {
    return { ok: false, error: "请输入待解码文本" };
  }
  try {
    const value =
      mode === "uri" ? decodeURI(raw) : decodeURIComponent(raw);
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err || "解码失败（可能含非法 % 序列）"),
    };
  }
}
