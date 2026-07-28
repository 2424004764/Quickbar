import { describe, expect, it } from "vitest";
import {
  HOST_SETTINGS_ICON_DATA_URL,
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
