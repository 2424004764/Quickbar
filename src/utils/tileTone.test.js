import { describe, expect, it } from "vitest";
import { tileToneKey, toneForTile } from "./tileTone.js";

/**
 * 目的：同插件在不同区块得到同一 tone。
 * 运行：cd C:\\dev\\quickbar && npx vitest run src/utils/tileTone.test.js
 */
describe("tileTone", () => {
  it("抽出稳定业务键", () => {
    expect(tileToneKey("plugin:json-format", "json-format")).toBe("json-format");
    expect(tileToneKey("plugin-cmd:json-format:jwt", "json-format")).toBe(
      "json-format",
    );
    expect(tileToneKey("pin:market", "market")).toBe("market");
  });

  it("同 id 跨区块颜色一致", () => {
    const a = toneForTile({ id: "plugin:json-format", payload: "json-format" });
    const b = toneForTile({ id: "x", payload: "json-format" });
    const c = toneForTile({
      id: "plugin:json-format",
      payload: "json-format",
      kind: "plugin",
    });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("市场入口固定蓝色", () => {
    expect(toneForTile({ id: "pin:market", payload: "market" })).toBe("blue");
  });
});
