import { describe, expect, it } from "vitest";
import {
  hotkeyFromEvent,
  isBlockedHotkey,
  mainKeyFromEvent,
} from "./hotkeyFromEvent.js";

/**
 * 目的：从键盘事件拼出 Ctrl/Alt/Shift + 主键；拒绝纯修饰键与 Alt+Space。
 * 运行：cd /mnt/c/dev/quickbar && npx vitest run src/utils/hotkeyFromEvent.test.js
 */
describe("热键事件解析", () => {
  it("Ctrl+Space 可解析", () => {
    expect(
      hotkeyFromEvent({
        key: " ",
        code: "Space",
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBe("Ctrl+Space");
  });

  it("Alt+Q 可解析", () => {
    expect(
      hotkeyFromEvent({
        key: "q",
        code: "KeyQ",
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBe("Alt+Q");
  });

  it("无修饰键时返回 null", () => {
    expect(
      hotkeyFromEvent({
        key: "a",
        code: "KeyA",
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBeNull();
  });

  it("Alt+Space 视为危险组合", () => {
    expect(
      hotkeyFromEvent({
        key: " ",
        code: "Space",
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBeNull();
    expect(isBlockedHotkey("Alt+Space")).toBe(true);
  });

  it("mainKey 识别字母与功能键", () => {
    expect(mainKeyFromEvent({ key: "a", code: "KeyA" })).toBe("A");
    expect(mainKeyFromEvent({ key: "F5", code: "F5" })).toBe("F5");
  });
});
