/**
 * 插件运行页：可内嵌主窗，也可分离为独立窗口（置顶等）
 */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideMainWindow } from "../pluginApi/api";
import { openDetachedPluginWindow } from "../utils/pluginWindow";
import { handleWindowDragMouseDown } from "../utils/windowDrag";
import { Base64Tool } from "./Base64Tool";
import { ColorConvertTool } from "./ColorConvertTool";
import { DiskUsageTool } from "./DiskUsageTool";
import { HashTool } from "./HashTool";
import { JsonFormatTool } from "./JsonFormatTool";
import { JwtParseTool } from "./JwtParseTool";
import { PasswordGenTool } from "./PasswordGenTool";
import { PgMigrateTool } from "./PgMigrateTool";
import { RegexLabTool } from "./RegexLabTool";
import { TextDiffTool } from "./TextDiffTool";
import { TimestampTool } from "./TimestampTool";
import { UrlCodecTool } from "./UrlCodecTool";
import { UuidTool } from "./UuidTool";

/**
 * @param {{
 *   pluginId: string,
 *   title?: string,
 *   detached?: boolean,
 *   onBack: () => void,
 *   onDetached?: () => void,
 * }} props
 */
export function PluginRunner({
  pluginId,
  title,
  detached = false,
  onBack,
  onDetached,
}) {
  const label = title || pluginId;
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (!menuRef.current?.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function handleDetach() {
    setMenuOpen(false);
    try {
      await openDetachedPluginWindow(pluginId, label);
      onDetached?.();
    } catch (err) {
      console.error("detach failed", err);
    }
  }

  async function handleTogglePin() {
    try {
      const win = getCurrentWindow();
      const next = !pinned;
      await win.setAlwaysOnTop(next);
      setPinned(next);
    } catch (err) {
      console.error("pin failed", err);
    }
  }

  async function handleExitBackground() {
    setMenuOpen(false);
    if (detached) {
      await getCurrentWindow().minimize();
      return;
    }
    // 退出到后台：隐藏主窗但保留当前插件会话
    await hideMainWindow();
  }

  async function handleEnd() {
    setMenuOpen(false);
    if (detached) {
      await getCurrentWindow().close();
      return;
    }
    onBack?.();
  }

  return (
    <div className={["pr-shell", detached ? "is-detached" : ""].join(" ")}>
      <header
        className="pr-header is-drag-region"
        onMouseDown={handleWindowDragMouseDown}
      >
        {!detached ? (
          <button
            type="button"
            className="btn ghost"
            data-no-drag
            onClick={onBack}
          >
            ← 返回
          </button>
        ) : null}
        <h2 className="pr-title">{label}</h2>
        <div
          className="pr-header-actions"
          data-no-drag
        >
          {detached ? (
            <button
              type="button"
              className={["btn", "pr-pin-btn", pinned ? "is-on" : ""].join(" ")}
              title={pinned ? "取消置顶" : "窗口置顶"}
              onClick={() => void handleTogglePin()}
            >
              {pinned ? "已置顶" : "置顶"}
            </button>
          ) : (
            <button
              id="qb-detach-btn"
              type="button"
              className="btn"
              title="分离为独立窗口 Ctrl+D"
              onClick={() => void handleDetach()}
            >
              分离窗口
            </button>
          )}
          <div
            className="pr-menu-wrap"
            ref={menuRef}
          >
            <button
              type="button"
              className="btn"
              aria-label="更多"
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="pr-menu">
                {!detached ? (
                  <button
                    type="button"
                    className="pr-menu-item"
                    onClick={() => void handleDetach()}
                  >
                    <span>分离为独立窗口</span>
                    <kbd>Ctrl+D</kbd>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pr-menu-item"
                    onClick={() => void handleTogglePin()}
                  >
                    <span>{pinned ? "取消置顶" : "窗口置顶"}</span>
                  </button>
                )}
                <div className="pr-menu-sep" />
                <button
                  type="button"
                  className="pr-menu-item"
                  onClick={() => void handleExitBackground()}
                >
                  <span>{detached ? "最小化" : "退出到后台"}</span>
                  <kbd>Esc</kbd>
                </button>
                <button
                  type="button"
                  className="pr-menu-item danger"
                  onClick={() => void handleEnd()}
                >
                  <span>结束运行</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <div className="pr-body">
        {pluginId === "json-format" ? (
          <JsonFormatTool />
        ) : pluginId === "jwt-parse" ? (
          <JwtParseTool />
        ) : pluginId === "text-diff" ? (
          <TextDiffTool />
        ) : pluginId === "timestamp" ? (
          <TimestampTool />
        ) : pluginId === "password-gen" ? (
          <PasswordGenTool />
        ) : pluginId === "base64-codec" ? (
          <Base64Tool />
        ) : pluginId === "url-codec" ? (
          <UrlCodecTool />
        ) : pluginId === "text-hash" ? (
          <HashTool />
        ) : pluginId === "uuid-gen" ? (
          <UuidTool />
        ) : pluginId === "regex-lab" ? (
          <RegexLabTool />
        ) : pluginId === "color-convert" ? (
          <ColorConvertTool />
        ) : pluginId === "pg-migrate" ? (
          <PgMigrateTool />
        ) : pluginId === "disk-usage" ? (
          <DiskUsageTool />
        ) : pluginId === "apps" ? (
          <HintTool
            text="系统应用已接入全局搜索。返回后直接输入应用名即可打开。"
            onBack={onBack}
            detached={detached}
          />
        ) : pluginId === "commands" ? (
          <HintTool
            text="自定义命令已接入全局搜索。返回后输入命令名即可运行。"
            onBack={onBack}
            detached={detached}
          />
        ) : (
          <HintTool
            text={`插件「${label}」已打开。后续可为该插件接入独立界面。`}
            onBack={onBack}
            detached={detached}
          />
        )}
      </div>
    </div>
  );
}

function HintTool({ text, onBack, detached }) {
  if (detached) {
    return (
      <div className="pr-hint">
        <p>{text}</p>
      </div>
    );
  }
  return (
    <div className="pr-hint">
      <p>{text}</p>
      <button
        type="button"
        className="btn primary"
        onClick={onBack}
      >
        回到启动页
      </button>
    </div>
  );
}
