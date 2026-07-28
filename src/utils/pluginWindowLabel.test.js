/**
 * 独立窗 label / 偏移
 * 运行：cd C:\\dev\\quickbar && npm test -- src/utils/pluginWindowLabel.test.js
 */
import { describe, expect, it } from "vitest";
import { detachWindowOffset, makePluginWindowLabel } from "./pluginWindowLabel";

describe("分离窗口 · 窗口标识", () => {
  it("同一插件多次分离应生成不同 label，且以 plugin- 开头", () => {
    const a = makePluginWindowLabel("json-format", 1, 1000);
    const b = makePluginWindowLabel("json-format", 2, 1000);
    expect(a.startsWith("plugin-")).toBe(true);
    expect(b.startsWith("plugin-")).toBe(true);
    expect(a).not.toBe(b);
    expect(a).toBe("plugin-json-format-1000-1");
    expect(b).toBe("plugin-json-format-1000-2");
  });

  it("插件 id 中的非法字符应清洗为安全字符", () => {
    expect(makePluginWindowLabel("a/b c", 1, 1)).toBe("plugin-a-b-c-1-1");
  });
});

describe("分离窗口 · 多窗错开位置", () => {
  it("按分离序号计算像素偏移，避免完全重叠", () => {
    expect(detachWindowOffset(1)).toBe(0);
    expect(detachWindowOffset(2)).toBe(28);
    expect(detachWindowOffset(9)).toBe(0);
  });
});
