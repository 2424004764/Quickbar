/**
 * 独立插件窗启动参数
 * 运行：cd C:\\dev\\quickbar && npm test -- src/utils/bootParams.test.js
 */
import { describe, expect, it } from "vitest";
import { readBootParams } from "./bootParams";

describe("独立插件窗 · 启动参数解析", () => {
  it("能解析 view/id/title/detached 查询串", () => {
    const p = readBootParams(
      "?view=plugin&id=json-format&title=JSON%20%E7%BC%96%E8%BE%91%E5%99%A8&detached=1",
    );
    expect(p.view).toBe("plugin");
    expect(p.pluginId).toBe("json-format");
    expect(p.pluginTitle).toBe("JSON 编辑器");
    expect(p.detached).toBe(true);
  });

  it("无参数时默认为搜索首页", () => {
    const p = readBootParams("");
    expect(p.view).toBe("search");
    expect(p.pluginId).toBe("");
    expect(p.detached).toBe(false);
  });

  it("能解析分离网页窗参数", () => {
    const p = readBootParams(
      "?view=browser&url=https%3A%2F%2Fwww.v2ex.com%2F&title=V2EX&detached=1",
    );
    expect(p.view).toBe("browser");
    expect(p.browserUrl).toBe("https://www.v2ex.com/");
    expect(p.browserTitle).toBe("V2EX");
    expect(p.detached).toBe(true);
  });
});
