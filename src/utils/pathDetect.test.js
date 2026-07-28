import { describe, expect, it } from "vitest";
import { normalizeLaunchablePathText } from "./pathDetect.js";

/**
 * 目的：粘贴路径识别 .exe/.lnk。
 * 运行：cd C:\\dev\\quickbar && npx vitest run src/utils/pathDetect.test.js
 */
describe("pathDetect", () => {
  it("识别带引号的 exe", () => {
    expect(
      normalizeLaunchablePathText('"C:\\Tools\\todo-manager.exe"'),
    ).toBe("C:\\Tools\\todo-manager.exe");
  });

  it("识别 file URL 与 lnk", () => {
    expect(
      normalizeLaunchablePathText("file:///C:/Apps/foo.lnk"),
    ).toBe("C:\\Apps\\foo.lnk");
  });

  it("拒绝非可执行路径", () => {
    expect(normalizeLaunchablePathText("readme.txt")).toBeNull();
    expect(normalizeLaunchablePathText("todo-manager")).toBeNull();
  });
});
