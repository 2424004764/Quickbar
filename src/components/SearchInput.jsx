/**
 * 启动器搜索输入框（顶栏可拖动窗口）
 * 粘贴 .exe/.lnk 路径时规范化，供「加入本地启动」
 */
import { launchablePathFromPasteEvent } from "../utils/pathDetect";
import { handleWindowDragMouseDown } from "../utils/windowDrag";

export function SearchInput({
  value,
  onChange,
  onSubmit,
  onEscape,
  inputRef,
  placeholder = "搜索应用、命令、插件…",
}) {
  return (
    <div
      className="search-input-wrap is-drag-region"
      onMouseDown={handleWindowDragMouseDown}
    >
      <input
        ref={inputRef}
        className="search-input"
        data-no-drag
        value={value}
        placeholder={placeholder}
        autoFocus
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const path = launchablePathFromPasteEvent(e);
          if (!path) {
            return;
          }
          e.preventDefault();
          onChange(path);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit?.();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onEscape?.();
          }
        }}
      />
    </div>
  );
}
