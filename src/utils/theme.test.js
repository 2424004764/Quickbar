import { describe, expect, it } from "vitest";
import {
  normalizeTheme,
  resolveAppearance,
} from "./theme.js";

/**
 * 主题偏好规范化与解析
 * 运行：cd /mnt/c/dev/quickbar && npx vitest run src/utils/theme.test.js
 */
describe("normalizeTheme", () => {
  it("接受 dark / light / system，其它回退 system", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("Light")).toBe("light");
    expect(normalizeTheme("SYSTEM")).toBe("system");
    expect(normalizeTheme("")).toBe("system");
    expect(normalizeTheme("auto")).toBe("system");
  });
});

describe("resolveAppearance", () => {
  it("固定主题直接返回", () => {
    expect(resolveAppearance("dark")).toBe("dark");
    expect(resolveAppearance("light")).toBe("light");
  });
});
