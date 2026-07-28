/**
 * 窗口顶栏拖动手柄：整条可拖，不挡下方交互
 */
import { handleWindowDragMouseDown } from "../utils/windowDrag";

export function WindowDragBar() {
  return (
    <div
      className="window-drag-bar"
      title="拖动窗口"
      onMouseDown={handleWindowDragMouseDown}
    />
  );
}
