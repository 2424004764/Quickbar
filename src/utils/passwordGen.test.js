import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS,
  buildCharset,
  estimateEntropyBits,
  generatePassword,
  generatePasswords,
  randomInt,
  strengthFromEntropy,
} from "./passwordGen.js";

/**
 * 目的：字符集组合、均匀随机、密码约束与强度分级。
 * 运行：cd C:\\dev\\quickbar && npx vitest run src/utils/passwordGen.test.js
 */

/** 确定性伪随机：依次返回固定字节 */
function seqBytes(bytes) {
  let i = 0;
  return () => {
    const v = bytes[i % bytes.length];
    i += 1;
    return v;
  };
}

describe("随机密码", () => {
  it("buildCharset 按选项组合并排除易混淆", () => {
    const set = buildCharset({
      length: 12,
      lower: true,
      upper: false,
      digit: true,
      symbol: false,
      excludeAmbiguous: true,
    });
    expect(set).toContain("a");
    expect(set).toContain("2");
    expect(set).not.toContain("0");
    expect(set).not.toContain("l");
  });

  it("randomInt 落在范围内", () => {
    const rb = seqBytes([0, 1, 5, 9, 255]);
    for (let i = 0; i < 20; i += 1) {
      const n = randomInt(10, rb);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
  });

  it("生成密码覆盖已选类型且长度正确", () => {
    const r = generatePassword({
      length: 16,
      lower: true,
      upper: true,
      digit: true,
      symbol: true,
      excludeAmbiguous: false,
    });
    expect(r.ok).toBe(true);
    expect(r.password).toHaveLength(16);
    expect(/[a-z]/.test(r.password || "")).toBe(true);
    expect(/[A-Z]/.test(r.password || "")).toBe(true);
    expect(/\d/.test(r.password || "")).toBe(true);
  });

  it("排除易混淆时不含歧义字符", () => {
    for (let i = 0; i < 10; i += 1) {
      const r = generatePassword({
        length: 24,
        lower: true,
        upper: true,
        digit: true,
        symbol: false,
        excludeAmbiguous: true,
      });
      expect(r.ok).toBe(true);
      for (const ch of AMBIGUOUS) {
        expect(r.password).not.toContain(ch);
      }
    }
  });

  it("未勾选类型时报错", () => {
    const r = generatePassword({
      length: 12,
      lower: false,
      upper: false,
      digit: false,
      symbol: false,
    });
    expect(r.ok).toBe(false);
  });

  it("批量生成", () => {
    const list = generatePasswords(
      {
        length: 8,
        lower: true,
        upper: true,
        digit: true,
        symbol: false,
      },
      3,
    );
    expect(list).toHaveLength(3);
    expect(list.every((x) => x.ok)).toBe(true);
  });

  it("熵与强度", () => {
    expect(estimateEntropyBits(8, 62)).toBeGreaterThan(40);
    expect(strengthFromEntropy(30)).toBe("weak");
    expect(strengthFromEntropy(70)).toBe("strong");
  });
});
