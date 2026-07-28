/**
 * 将键盘事件转为 Quickbar 热键字符串（如 Ctrl+Space）
 * 仅在「修饰键 + 主键」齐全时返回；纯修饰键返回 null。
 */

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

const KEY_ALIASES = {
  " ": "Space",
  Spacebar: "Space",
  Esc: "Escape",
  Escape: "Escape",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
};

/**
 * @param {KeyboardEvent | { key: string, code?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }} event
 * @returns {string | null}
 */
export function hotkeyFromEvent(event) {
  if (!event || MODIFIER_KEYS.has(event.key)) {
    return null;
  }

  const parts = [];
  // Windows / Linux 用 Ctrl；仅 mac 上单独 Meta（无 Ctrl）时记为 Meta
  if (event.ctrlKey) {
    parts.push("Ctrl");
  } else if (event.metaKey) {
    parts.push("Meta");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }

  const main = mainKeyFromEvent(event);
  if (!main) {
    return null;
  }
  // 全局唤起热键至少要有一个修饰键，避免误占单键
  if (parts.length === 0) {
    return null;
  }

  parts.push(main);
  const hotkey = parts.join("+");
  if (hotkey.replace(/\s+/g, "").toLowerCase() === "alt+space") {
    return null;
  }
  return hotkey;
}

/**
 * @param {{ key: string, code?: string }} event
 * @returns {string | null}
 */
export function mainKeyFromEvent(event) {
  const code = String(event.code || "");
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^F([1-9]|1[0-2])$/.test(code)) {
    return code;
  }
  if (code === "Space") {
    return "Space";
  }
  if (KEY_ALIASES[event.key]) {
    return KEY_ALIASES[event.key];
  }
  if (typeof event.key === "string" && event.key.length === 1) {
    return event.key.toUpperCase();
  }
  return null;
}

/**
 * 判断是否为被系统占用的危险组合
 * @param {string} hotkey
 */
export function isBlockedHotkey(hotkey) {
  return String(hotkey || "")
    .replace(/\s+/g, "")
    .toLowerCase() === "alt+space";
}
