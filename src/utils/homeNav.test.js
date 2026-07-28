import { describe, expect, it } from "vitest";
import {
  findHomeTilePos,
  firstHomeTile,
  moveHomeSelection,
  tileNavKey,
} from "./homeNav.js";

/**
 * 首页磁贴方向键导航（含同 id 不同分区）
 * 运行：cd /mnt/c/dev/quickbar && npx vitest run src/utils/homeNav.test.js
 */
const rows = [
  [
    { id: "plugin:json", navKey: "recent:plugin:json" },
    { id: "a2", navKey: "recent:a2" },
    { id: "a3", navKey: "recent:a3" },
  ],
  [
    { id: "plugin:json", navKey: "pinned:plugin:json" },
    { id: "b2", navKey: "pinned:b2" },
  ],
  [{ id: "plugin:json", navKey: "picks:plugin:json" }],
];

describe("tileNavKey", () => {
  it("优先 navKey", () => {
    expect(tileNavKey({ id: "a", navKey: "r:a" })).toBe("r:a");
    expect(tileNavKey({ id: "a" })).toBe("a");
  });
});

describe("firstHomeTile", () => {
  it("取第一行第一个", () => {
    expect(tileNavKey(firstHomeTile(rows))).toBe("recent:plugin:json");
    expect(firstHomeTile([])).toBeNull();
  });
});

describe("findHomeTilePos", () => {
  it("按 navKey 定位，同 id 不串行", () => {
    expect(findHomeTilePos(rows, "pinned:plugin:json")).toEqual({
      row: 1,
      col: 0,
    });
    expect(findHomeTilePos(rows, "picks:plugin:json")).toEqual({
      row: 2,
      col: 0,
    });
  });
});

describe("moveHomeSelection", () => {
  it("左右在同行与跨行衔接", () => {
    expect(moveHomeSelection(rows, "recent:a2", "left")).toBe(
      "recent:plugin:json",
    );
    expect(moveHomeSelection(rows, "recent:a3", "right")).toBe(
      "pinned:plugin:json",
    );
  });

  it("上下按列对齐", () => {
    expect(moveHomeSelection(rows, "recent:a2", "down")).toBe("pinned:b2");
    expect(moveHomeSelection(rows, "pinned:plugin:json", "down")).toBe(
      "picks:plugin:json",
    );
  });
});
