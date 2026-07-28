/**
 * 识别剪贴板/搜索框中的可启动路径（.exe / .lnk）
 */

/**
 * @param {string} raw
 * @returns {string | null} 规范化后的路径文本；无法识别则 null
 */
export function normalizeLaunchablePathText(raw) {
  let s = String(raw ?? "").trim();
  if (!s) {
    return null;
  }
  if (
    (s.startsWith('"') && s.endsWith('"'))
    || (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (s.toLowerCase().startsWith("file:///")) {
    s = s.slice("file:///".length);
  } else if (s.toLowerCase().startsWith("file://")) {
    s = s.slice("file://".length);
  }
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep original
  }
  s = s.replace(/\//g, "\\");
  if (!/\.(exe|lnk)$/i.test(s)) {
    return null;
  }
  // Windows 盘符或 UNC
  if (!/^[a-zA-Z]:\\/.test(s) && !s.startsWith("\\\\")) {
    return null;
  }
  return s;
}

/**
 * @param {ClipboardEvent} event
 * @returns {string | null}
 */
export function launchablePathFromPasteEvent(event) {
  const text = event.clipboardData?.getData("text") || "";
  return normalizeLaunchablePathText(text);
}
