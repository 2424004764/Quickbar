/**
 * 将插件分离为独立窗口
 * 每次分离使用唯一 label，可同时开多个窗口（含同一插件多实例）
 */
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { detachWindowOffset, makePluginWindowLabel } from "./pluginWindowLabel";

let detachSeq = 0;

/**
 * @param {string} pluginId
 * @param {string} [title]
 */
export async function openDetachedPluginWindow(pluginId, title = "") {
  detachSeq += 1;
  const label = makePluginWindowLabel(pluginId, detachSeq);
  const offset = detachWindowOffset(detachSeq);

  const q = new URLSearchParams({
    view: "plugin",
    id: pluginId,
    title: title || pluginId,
    detached: "1",
  });

  const win = new WebviewWindow(label, {
    url: `index.html?${q.toString()}`,
    title: title || pluginId,
    width: 860,
    height: 640,
    center: true,
    decorations: true,
    resizable: true,
    fullscreen: false,
    focus: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    visible: true,
  });

  return new Promise((resolve, reject) => {
    win.once("tauri://created", async () => {
      try {
        if (offset > 0) {
          const pos = await win.outerPosition();
          await win.setPosition(new PhysicalPosition(pos.x + offset, pos.y + offset));
        }
      } catch {
        // 定位失败不影响开窗
      }
      resolve(win);
    });
    win.once("tauri://error", (e) => reject(e));
  });
}
