/**
 * 目的：Base64 / URL / MD5 / 颜色 / 正则等工具纯函数回归。
 * 运行：cd C:\\dev\\quickbar && npx vitest run src/utils/devToolsCodec.test.js
 */
import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64Codec.js";
import { parseColor } from "./colorConvert.js";
import { md5Hex } from "./md5.js";
import { buildRegex, listMatches, replaceAllPreview } from "./regexLab.js";
import { decodeUrl, encodeUrl } from "./urlCodec.js";
import { generateIds, randomUuidV4 } from "./uuidGen.js";

describe("Base64", () => {
  it("往返 UTF-8", () => {
    const enc = encodeBase64("你好 Quickbar");
    expect(enc.ok).toBe(true);
    const dec = decodeBase64(enc.value);
    expect(dec.ok).toBe(true);
    expect(dec.value).toBe("你好 Quickbar");
  });

  it("URL-safe", () => {
    const enc = encodeBase64("a??", { urlSafe: true });
    expect(enc.ok).toBe(true);
    expect(enc.value.includes("+") || enc.value.includes("/")).toBe(false);
    const dec = decodeBase64(enc.value, { urlSafe: true });
    expect(dec.ok).toBe(true);
    expect(dec.value).toBe("a??");
  });
});

describe("URL", () => {
  it("component 编码中文与空格", () => {
    const enc = encodeUrl("中 文", "component");
    expect(enc.ok).toBe(true);
    expect(enc.value).toContain("%");
    const dec = decodeUrl(enc.value, "component");
    expect(dec.value).toBe("中 文");
  });
});

describe("MD5", () => {
  it("空串与 hello", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("hello")).toBe("5d41402abc4b2a76b9719d911017c592");
  });
});

describe("UUID", () => {
  it("v4 格式", () => {
    expect(randomUuidV4()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("批量生成", () => {
    expect(generateIds(3, "uuid")).toHaveLength(3);
    expect(generateIds(2, "short", 4)[0]).toHaveLength(8);
  });
});

describe("正则", () => {
  it("匹配与替换", () => {
    const built = buildRegex("\\d+", "g");
    expect(built.ok).toBe(true);
    const ms = listMatches("a1 b22", built.regex);
    expect(ms.map((m) => m.match)).toEqual(["1", "22"]);
    expect(replaceAllPreview("a1 b22", built.regex, "#")).toBe("a# b#");
  });
});

describe("颜色", () => {
  it("解析 hex 与互转", () => {
    const c = parseColor("#e5a84b");
    expect(c.ok).toBe(true);
    expect(c.hex).toBe("#e5a84b");
    expect(c.rgb).toBe("rgb(229, 168, 75)");
    expect(parseColor(c.hsl).ok).toBe(true);
  });
});
