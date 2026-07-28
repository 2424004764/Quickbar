import { describe, expect, it } from "vitest";
import {
  diffLineOps,
  diffTexts,
  normalizeLine,
  textsEqual,
} from "./textDiff.js";

/**
 * 目的：行级 LCS diff、忽略空白、统一 diff 文本。
 * 运行：cd C:\\dev\\quickbar && npx vitest run src/utils/textDiff.test.js
 */
describe("文本对比", () => {
  it("相同行识别为 same", () => {
    const ops = diffLineOps(["a", "b"], ["a", "b"]);
    expect(ops.every((o) => o.type === "same")).toBe(true);
  });

  it("增删行统计正确", () => {
    const result = diffTexts("a\nb\nc", "a\nx\nc");
    expect(result.stats.same).toBe(2);
    expect(result.stats.del).toBe(1);
    expect(result.stats.add).toBe(1);
    expect(result.unified).toContain("-b");
    expect(result.unified).toContain("+x");
  });

  it("忽略空白后可判等", () => {
    expect(normalizeLine("  foo   bar  ", { ignoreWhitespace: true })).toBe(
      "foo bar",
    );
    expect(
      textsEqual("foo  bar", " foo bar ", { ignoreWhitespace: true }),
    ).toBe(true);
  });

  it("忽略大小写", () => {
    expect(textsEqual("Hello", "hello", { ignoreCase: true })).toBe(true);
    const result = diffTexts("Hello", "hello", { ignoreCase: true });
    expect(result.stats.add + result.stats.del).toBe(0);
  });

  it("空文本对比", () => {
    const result = diffTexts("", "a\nb");
    expect(result.stats.add).toBe(2);
    expect(result.stats.del).toBe(0);
  });
});
