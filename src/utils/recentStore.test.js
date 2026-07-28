/**
 * 最近使用纠正
 * 运行：cd C:\\dev\\quickbar && npm test -- src/utils/recentStore.test.js
 */
import { describe, expect, it } from "vitest";
import { normalizeRecentTile } from "./recentStore";

describe("最近使用 · 历史记录纠正", () => {
  it("误记成打开市场时，应纠正为打开插件", () => {
    const fixed = normalizeRecentTile({
      id: "x",
      title: "JSON",
      action: "open_market",
      payload: "json-format",
      kind: "plugin",
    });
    expect(fixed.action).toBe("open_plugin");
    expect(fixed.id).toBe("plugin:json-format");
    expect(fixed.kind).toBe("plugin");
  });

  it("真正的「应用市场」入口保持打开市场，并统一标题", () => {
    const tile = {
      id: "pin:market",
      title: "插件应用市场",
      action: "open_market",
      payload: "market",
      kind: "plugin",
    };
    expect(normalizeRecentTile(tile)).toEqual({
      ...tile,
      title: "应用市场",
    });
  });

  it("noop / 安装市场项应纠正为打开插件", () => {
    expect(
      normalizeRecentTile({
        id: "a",
        title: "JSON",
        action: "noop",
        payload: "json-format",
      }).action,
    ).toBe("open_plugin");
    expect(
      normalizeRecentTile({
        id: "b",
        title: "JSON",
        action: "install_market",
        payload: "json-format",
      }).action,
    ).toBe("open_plugin");
  });
});
