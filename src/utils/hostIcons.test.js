import { describe, expect, it } from "vitest";
import {
  HOST_LINUX_DO_ICON_DATA_URL,
  HOST_SETTINGS_ICON_DATA_URL,
  HOST_V2EX_ICON_DATA_URL,
  resolveBuiltinTileIcon,
  withBuiltinIcons,
} from "./hostIcons";

describe("hostIcons", () => {
  it("ms-settings 磁贴同步给齿轮图标，避免先闪字母", () => {
    const icon = resolveBuiltinTileIcon({
      title: "Windows 设置",
      action: "open_path",
      payload: "ms-settings:",
    });
    expect(icon).toBe(HOST_SETTINGS_ICON_DATA_URL);
    expect(icon.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("内置网页入口有固定图标", () => {
    expect(
      resolveBuiltinTileIcon({
        id: "pin:linux-do",
        action: "open_path",
        payload: "https://linux.do/",
      }),
    ).toBe(HOST_LINUX_DO_ICON_DATA_URL);
    expect(
      resolveBuiltinTileIcon({
        id: "pin:v2ex",
        action: "open_path",
        payload: "https://www.v2ex.com/",
      }),
    ).toBe(HOST_V2EX_ICON_DATA_URL);
  });

  it("withBuiltinIcons 补齐缺失图标且不覆盖已有", () => {
    const tiles = withBuiltinIcons([
      {
        id: "a",
        action: "open_path",
        payload: "ms-settings:",
      },
      {
        id: "b",
        action: "open_path",
        payload: "C:\\a.exe",
        iconDataUrl: "data:keep",
      },
    ]);
    expect(tiles[0].iconDataUrl).toBe(HOST_SETTINGS_ICON_DATA_URL);
    expect(tiles[1].iconDataUrl).toBe("data:keep");
  });
});
