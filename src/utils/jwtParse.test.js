import { describe, expect, it } from "vitest";
import {
  base64UrlToUtf8,
  extractJwtToken,
  formatDuration,
  formatJwtTime,
  parseJwt,
} from "./jwtParse.js";

function b64url(obj) {
  const json = JSON.stringify(obj);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * 目的：Base64URL 与 Bearer 前缀提取、标准三节 JWT 解码。
 * 运行：cd C:\\dev\\quickbar && npx vitest run src/utils/jwtParse.test.js
 */
describe("JWT 解析", () => {
  it("base64Url 解码 UTF-8", () => {
    const seg = b64url({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(base64UrlToUtf8(seg))).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
  });

  it("提取 Bearer 前缀与杂质中的 token", () => {
    const token = `${b64url({ alg: "none" })}.${b64url({ sub: "1" })}.sig`;
    expect(extractJwtToken(`Bearer ${token}`)).toBe(token);
    expect(extractJwtToken(`token=${token};`)).toBe(token);
  });

  it("解析 header/payload 并汇总时间声明", () => {
    const now = 1_700_000_000;
    const token = [
      b64url({ alg: "HS256", typ: "JWT" }),
      b64url({ sub: "u1", iat: now - 10, exp: now + 90 }),
      "signature",
    ].join(".");
    const result = parseJwt(token, now);
    expect(result.ok).toBe(true);
    expect(result.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(result.payload).toMatchObject({ sub: "u1" });
    expect(result.signature).toBe("signature");
    expect(result.claims?.some((c) => c.key === "ttl" && c.tone === "ok")).toBe(
      true,
    );
  });

  it("过期 token 标记 danger", () => {
    const now = 1_700_000_000;
    const token = [
      b64url({ alg: "none" }),
      b64url({ exp: now - 1 }),
      "x",
    ].join(".");
    const result = parseJwt(token, now);
    expect(result.ok).toBe(true);
    const exp = result.claims?.find((c) => c.key === "exp");
    expect(exp?.tone).toBe("danger");
  });

  it("时间与时长格式化", () => {
    expect(formatJwtTime(0)).toMatch(/1970/);
    expect(formatDuration(3661)).toBe("1小时1分1秒");
  });

  it("非法内容返回错误", () => {
    expect(parseJwt("not-a-jwt").ok).toBe(false);
    expect(parseJwt("aaa.!!!").ok).toBe(false);
  });
});
