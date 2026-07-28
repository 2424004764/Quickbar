/**
 * 无边框窗口拖动（Windows WebView2 上用 startDragging）
 * 拖动过程中会短暂失焦，需压制「失焦隐藏」
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setBlurHideEnabled } from "../pluginApi/api";

const NO_DRAG_SELECTOR = [
  "input",
  "textarea",
  "button",
  "a",
  "select",
  "option",
  "label",
  "[contenteditable='true']",
  "[data-no-drag]",
].join(",");

/** 拖动中 / 刚松手：前端失焦隐藏应跳过 */
let blurSuppressed = false;
let releaseTimer = 0;

/** @returns {boolean} */
export function isWindowDragBlurSuppressed() {
  return blurSuppressed;
}

function beginBlurSuppress() {
  blurSuppressed = true;
  if (releaseTimer) {
    window.clearTimeout(releaseTimer);
    releaseTimer = 0;
  }
  void setBlurHideEnabled(false);
}

function endBlurSuppressSoon(ms = 250) {
  if (releaseTimer) {
    window.clearTimeout(releaseTimer);
  }
  // 松手后再等一会，避免拖动结束瞬间的失焦把窗口关掉
  releaseTimer = window.setTimeout(() => {
    releaseTimer = 0;
    blurSuppressed = false;
    void setBlurHideEnabled(true);
  }, ms);
}

/**
 * 短暂压制失焦隐藏（Esc 清空搜索导致窗口缩高时也会闪失焦）
 * @param {number} [ms]
 */
export function suppressBlurHideFor(ms = 400) {
  beginBlurSuppress();
  endBlurSuppressSoon(ms);
}

/**
 * @param {MouseEvent} event
 */
export function handleWindowDragMouseDown(event) {
  if (event.button !== 0) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (target.closest(NO_DRAG_SELECTOR)) {
    return;
  }

  beginBlurSuppress();

  const onPointerEnd = () => {
    window.removeEventListener("pointerup", onPointerEnd, true);
    window.removeEventListener("pointercancel", onPointerEnd, true);
    endBlurSuppressSoon();
  };
  window.addEventListener("pointerup", onPointerEnd, true);
  window.addEventListener("pointercancel", onPointerEnd, true);

  void getCurrentWindow()
    .startDragging()
    .catch((err) => {
      console.warn("startDragging failed", err);
      onPointerEnd();
    });
}
