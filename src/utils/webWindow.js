/**
 * 将网页应用分离为独立窗口
 */
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { detachWindowOffset, makeWebWindowLabel } from "./pluginWindowLabel";

let detachSeq = 0;

/**
 * @param {string} url
 * @param {string} [title]
 */
export async function openDetachedWebWindow(url, title = "") {
  const href = String(url || "").trim();
  if (!/^https?:\/\//i.test(href)) {
    throw new Error("无效网页地址");
  }
  detachSeq += 1;
  const label = makeWebWindowLabel(href, detachSeq);
  const offset = detachWindowOffset(detachSeq);
  const name = String(title || href).trim() || href;

  const q = new URLSearchParams({
    view: "browser",
    url: href,
    title: name,
    detached: "1",
  });

  const win = new WebviewWindow(label, {
    url: `index.html?${q.toString()}`,
    title: name,
    width: 960,
    height: 700,
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
