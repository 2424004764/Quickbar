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
/** 用户手动钉住：一直不失焦隐藏，直到取消 */
let pinned = false;

/** @returns {boolean} */
export function isWindowDragBlurSuppressed() {
  return pinned || blurSuppressed;
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
    if (pinned) {
      return;
    }
    void setBlurHideEnabled(true);
  }, ms);
}

/**
 * 钉住窗口：期间任何失焦都不隐藏（迁移执行、对照其他窗口操作时用）
 * @param {boolean} next
 */
export async function setBlurHidePinned(next) {
  pinned = Boolean(next);
  if (pinned && releaseTimer) {
    window.clearTimeout(releaseTimer);
    releaseTimer = 0;
  }
  try {
    await setBlurHideEnabled(!pinned);
  } catch (err) {
    console.warn("setBlurHideEnabled failed", err);
  }
}

/** @returns {boolean} */
export function isBlurHidePinned() {
  return pinned;
}

/**
 * 短暂压制失焦隐藏（Esc 清空搜索导致窗口缩高时也会闪失焦）
 * @param {number} [ms]
 */
export function suppressBlurHideFor(ms = 400) {
  beginBlurSuppress();
  endBlurSuppressSoon(ms);
}

/** 允许嵌套调用（同时开多个对话框时不提前解除压制） */
let suspendDepth = 0;

/** 对话框抢焦点若已把窗口藏掉，关闭后要自己找回来 */
async function restoreMainWindow() {
  try {
    const win = getCurrentWindow();
    if (!(await win.isVisible())) {
      await win.show();
    }
    await win.setFocus();
  } catch (err) {
    console.warn("restore window failed", err);
  }
}

/**
 * 执行期间压制失焦隐藏：打开系统文件对话框时主窗会失焦，不能被隐藏
 * @template T
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export async function runWithBlurHideSuspended(run) {
  suspendDepth += 1;
  blurSuppressed = true;
  if (releaseTimer) {
    window.clearTimeout(releaseTimer);
    releaseTimer = 0;
  }
  // 必须等后端确认再开对话框：Rust 侧失焦回调只延迟 120ms 就读开关，来不及就会隐藏
  try {
    await setBlurHideEnabled(false);
  } catch (err) {
    console.warn("setBlurHideEnabled failed", err);
  }
  try {
    return await run();
  } finally {
    suspendDepth -= 1;
    if (suspendDepth <= 0) {
      suspendDepth = 0;
      await restoreMainWindow();
      endBlurSuppressSoon(600);
    }
  }
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
