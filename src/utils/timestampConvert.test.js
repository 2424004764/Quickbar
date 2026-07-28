import { describe, expect, it } from "vitest";
import {
  detectTimestampUnit,
  formatRelative,
  nowTimestamps,
  parseDateTime,
  parseTimestamp,
} from "./timestampConvert.js";

/**
 * 目的：秒/毫秒识别、时间戳与日期互转、相对时间。
 * 运行：cd C:\\dev\\quickbar && npx vitest run src/utils/timestampConvert.test.js
 */
describe("时间戳转换", () => {
  it("自动识别秒与毫秒", () => {
    expect(detectTimestampUnit(1710000000)).toBe("s");
    expect(detectTimestampUnit(1710000000000)).toBe("ms");
  });

  it("秒级时间戳转为本地/UTC/ISO", () => {
    const r = parseTimestamp("1700000000", "s", 1700000000 * 1000);
    expect(r.ok).toBe(true);
    expect(r.sec).toBe(1700000000);
    expect(r.ms).toBe(1700000000000);
    expect(r.iso).toBe("2023-11-14T22:13:20.000Z");
    expect(r.relative).toBe("刚刚");
  });

  it("毫秒时间戳", () => {
    const r = parseTimestamp("1700000000123", "auto");
    expect(r.ok).toBe(true);
    expect(r.detectedUnit).toBe("ms");
    expect(r.ms).toBe(1700000000123);
  });

  it("日期字符串转时间戳", () => {
    const r = parseDateTime("2023-11-14 22:13:20");
    expect(r.ok).toBe(true);
    expect(typeof r.sec).toBe("number");
    expect(typeof r.ms).toBe("number");
  });

  it("ISO 字符串可解析", () => {
    const r = parseDateTime("2023-11-14T22:13:20.000Z");
    expect(r.ok).toBe(true);
    expect(r.sec).toBe(1700000000);
  });

  it("相对时间文案", () => {
    const now = 1_700_000_000_000;
    expect(formatRelative(now + 90_000, now)).toBe("1 分钟后");
    expect(formatRelative(now - 3_600_000, now)).toBe("1 小时前");
  });

  it("nowTimestamps", () => {
    const t = nowTimestamps(1_700_000_000_123);
    expect(t.ms).toBe(1700000000123);
    expect(t.sec).toBe(1700000000);
  });

  it("非法输入报错", () => {
    expect(parseTimestamp("abc").ok).toBe(false);
    expect(parseDateTime("").ok).toBe(false);
  });
});
