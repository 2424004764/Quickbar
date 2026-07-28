/**
 * JSON 过滤与折叠路径
 * 运行：cd C:\\dev\\quickbar && npm test -- src/utils/jsonFilter.test.js
 */
import { describe, expect, it } from "vitest";
import {
  applyJsonFilter,
  collectFoldablePaths,
  stringifyJsonResult,
} from "./jsonFilter";

const sample = {
  hello: "quickbar",
  key: { subkey: "nested-value" },
  items: [
    { val: 1, name: "a" },
    { val: 2, name: "b" },
  ],
};

describe("JSON 工具 · this 表达式过滤", () => {
  it("空表达式时保持原 JSON 不变", () => {
    expect(applyJsonFilter(sample, "")).toBe(sample);
    expect(applyJsonFilter(sample, "   ")).toBe(sample);
  });

  it("支持点路径 .key.subkey", () => {
    expect(applyJsonFilter(sample, ".key.subkey")).toBe("nested-value");
  });

  it("支持数组下标 [0]", () => {
    expect(applyJsonFilter(sample.items, "[0]")).toEqual({
      val: 1,
      name: "a",
    });
  });

  it("支持 .items.map(x=>x.val) 映射", () => {
    expect(applyJsonFilter(sample, ".items.map(x=>x.val)")).toEqual([1, 2]);
  });

  it("支持 this 前缀与无点字段名", () => {
    expect(applyJsonFilter(sample, "this.key.subkey")).toBe("nested-value");
    expect(applyJsonFilter(sample, "hello")).toBe("quickbar");
  });

  it("非法表达式应抛错", () => {
    expect(() => applyJsonFilter(sample, ".((((")).toThrow();
  });
});

describe("JSON 工具 · 结果序列化", () => {
  it("对象美化、字符串原样、undefined 转文案", () => {
    expect(stringifyJsonResult({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(stringifyJsonResult("hi")).toBe("hi");
    expect(stringifyJsonResult(undefined)).toBe("undefined");
  });
});

describe("JSON 工具 · 树形折叠路径", () => {
  it("收集对象与数组的可折叠路径，排除叶子字段", () => {
    const paths = collectFoldablePaths(sample);
    expect(paths).toContain("$");
    expect(paths).toContain("$.key");
    expect(paths).toContain("$.items");
    expect(paths).toContain("$.items[0]");
    expect(paths).toContain("$.items[1]");
    expect(paths).not.toContain("$.hello");
  });
});
