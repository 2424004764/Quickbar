/**
 * 设置页：唤起热键 + 界面主题
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getConfig,
  resumeGlobalHotkey,
  setBlurHideEnabled,
  setHotkey,
  setMarketBaseUrl,
  suspendGlobalHotkey,
} from "../pluginApi/api";
import { hotkeyFromEvent, isBlockedHotkey } from "../utils/hotkeyFromEvent";
import { THEME_OPTIONS, normalizeTheme } from "../utils/theme";
import { handleWindowDragMouseDown } from "../utils/windowDrag";

const PRESETS = [
  "Ctrl+Space",
  "Alt+Q",
  "Alt+Space",
  "Ctrl+Alt+Space",
  "Ctrl+Shift+Space",
  "Alt+Z",
];

/**
 * @param {{
 *   onBack: () => void,
 *   theme?: string,
 *   onThemeChange?: (theme: string) => Promise<void>,
 * }} props
 */
export function SettingsPanel({ onBack, theme = "system", onThemeChange }) {
  const [currentHotkey, setCurrentHotkey] = useState("Ctrl+Space");
  const [draftHotkey, setDraftHotkey] = useState("Ctrl+Space");
  const [marketBaseUrl, setMarketBaseUrlState] = useState("");
  const [draftMarketUrl, setDraftMarketUrl] = useState("");
  const [marketSaving, setMarketSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const recordingRef = useRef(false);
  const themePref = normalizeTheme(theme);

  const load = useCallback(async () => {
    setError("");
    try {
      const config = await getConfig();
      const hk = String(config?.hotkey || "Ctrl+Space").trim() || "Ctrl+Space";
      setCurrentHotkey(hk);
      setDraftHotkey(hk);
      const base = String(config?.marketBaseUrl || "").trim();
      setMarketBaseUrlState(base);
      setDraftMarketUrl(base);
    } catch (err) {
      setError(String(err?.message || err));
    }
  }, []);

  async function applyMarketBaseUrl() {
    setMarketSaving(true);
    setError("");
    setOkMsg("");
    try {
      const config = await setMarketBaseUrl(draftMarketUrl.trim());
      const next = String(config?.marketBaseUrl || "").trim();
      setMarketBaseUrlState(next);
      setDraftMarketUrl(next);
      setOkMsg(
        next
          ? `云端市场已设为：${next}`
          : "已清空云端市场地址，仅使用本地市场",
      );
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setMarketSaving(false);
    }
  }

  const applyHotkey = useCallback(async (hotkey) => {
    const value = String(hotkey || "").trim();
    if (!value) {
      setError("请先录制或选择一组热键");
      return;
    }
    if (isBlockedHotkey(value)) {
      setError("Alt+Space 与 Windows 系统菜单冲突，请换其它组合");
      return;
    }
    setSaving(true);
    setError("");
    setOkMsg("");
    try {
      if (recordingRef.current) {
        setRecording(false);
        recordingRef.current = false;
      }
      const config = await setHotkey(value);
      const hk = String(config?.hotkey || value);
      setCurrentHotkey(hk);
      setDraftHotkey(hk);
      setOkMsg(`已生效：${hk}`);
    } catch (err) {
      setError(String(err?.message || err));
      try {
        await resumeGlobalHotkey();
      } catch {
        /* ignore */
      }
    } finally {
      setSaving(false);
    }
  }, []);

  async function applyTheme(next) {
    if (!onThemeChange || normalizeTheme(next) === themePref) {
      return;
    }
    setThemeSaving(true);
    setError("");
    setOkMsg("");
    try {
      await onThemeChange(next);
      const label =
        THEME_OPTIONS.find((item) => item.value === normalizeTheme(next))
          ?.label || next;
      setOkMsg(`主题已切换：${label}`);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setThemeSaving(false);
    }
  }

  useEffect(() => {
    void setBlurHideEnabled(false);
    void load();
    return () => {
      recordingRef.current = false;
      void resumeGlobalHotkey().catch(() => {});
      void setBlurHideEnabled(true);
    };
  }, [load]);

  useEffect(() => {
    if (!recording) {
      return undefined;
    }

    function onKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        recordingRef.current = false;
        void resumeGlobalHotkey().catch((err) => {
          setError(String(err?.message || err));
        });
        return;
      }
      const next = hotkeyFromEvent(e);
      if (!next) {
        if (e.altKey && (e.key === " " || e.code === "Space")) {
          setError("Alt+Space 与 Windows 系统菜单冲突，请换其它组合");
        }
        return;
      }
      setDraftHotkey(next);
      setError("");
      setRecording(false);
      recordingRef.current = false;
      void applyHotkey(next);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, applyHotkey]);

  async function startRecording() {
    setError("");
    setOkMsg("");
    setRecording(true);
    recordingRef.current = true;
    try {
      await suspendGlobalHotkey();
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function cancelRecording() {
    setRecording(false);
    recordingRef.current = false;
    try {
      await resumeGlobalHotkey();
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  return (
    <div className="st-shell">
      <header
        className="st-topbar is-drag-region"
        onMouseDown={handleWindowDragMouseDown}
      >
        <button
          type="button"
          className="st-back"
          data-no-drag
          onClick={onBack}
        >
          ← 返回
        </button>
        <h2 className="st-title">设置</h2>
      </header>

      <div className="st-body">
        <section className="st-card">
          <h3 className="st-card-title">界面主题</h3>
          <p className="st-hint">
            深色 / 浅色可固定外观；「随系统」跟随 Windows 深浅色模式自动切换。
          </p>
          <div className="st-theme-list">
            {THEME_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={[
                  "st-theme",
                  item.value === themePref ? "is-active" : "",
                ].join(" ")}
                disabled={themeSaving}
                onClick={() => void applyTheme(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="st-card">
          <h3 className="st-card-title">云端应用市场</h3>
          <p className="st-hint">
            基址为空时只用本机市场。配置后可投稿插件、同步自建网页/本地应用（协议：
            <code>POST /market/submit</code>、<code>POST /market/submit-app</code>）。
          </p>
          <label className="st-label" htmlFor="st-market-url">
            市场基址
          </label>
          <input
            id="st-market-url"
            className="st-input"
            value={draftMarketUrl}
            onChange={(e) => {
              setDraftMarketUrl(e.target.value);
              setError("");
              setOkMsg("");
            }}
            placeholder="https://market.example.com 或留空"
            spellCheck={false}
          />
          <div className="st-actions">
            <button
              type="button"
              className="st-btn is-primary"
              disabled={
                marketSaving
                || draftMarketUrl.trim() === marketBaseUrl
              }
              onClick={() => void applyMarketBaseUrl()}
            >
              {marketSaving ? "保存中…" : "保存市场地址"}
            </button>
          </div>
        </section>

        <section className="st-card">
          <h3 className="st-card-title">唤起快捷键</h3>
          <p className="st-hint">
            全局组合键用于显示 / 隐藏 Quickbar。勿使用 Alt+Space（Windows
            系统菜单）。
          </p>

          <div className="st-hotkey-row">
            <div className="st-hotkey-display">
              <span className="st-label">当前</span>
              <kbd className="st-kbd">{currentHotkey}</kbd>
            </div>
            <div className="st-hotkey-display">
              <span className="st-label">待保存</span>
              <kbd className={["st-kbd", recording ? "is-recording" : ""].join(" ")}>
                {recording ? "请按下组合键…" : draftHotkey}
              </kbd>
            </div>
          </div>

          <div className="st-actions">
            <button
              type="button"
              className="st-btn"
              disabled={saving || recording}
              onClick={() => void startRecording()}
            >
              录制新热键
            </button>
            {recording ? (
              <button
                type="button"
                className="st-btn is-ghost"
                onClick={() => void cancelRecording()}
              >
                取消录制
              </button>
            ) : null}
            <button
              type="button"
              className="st-btn is-primary"
              disabled={saving || recording || draftHotkey === currentHotkey}
              onClick={() => void applyHotkey(draftHotkey)}
            >
              {saving ? "保存中…" : "保存并生效"}
            </button>
          </div>

          <div className="st-presets">
            <span className="st-label">常用组合</span>
            <div className="st-preset-list">
              {PRESETS.map((item) => {
                const blocked = isBlockedHotkey(item);
                return (
                  <button
                    key={item}
                    type="button"
                    className={[
                      "st-preset",
                      item === draftHotkey ? "is-active" : "",
                      blocked ? "is-blocked" : "",
                    ].join(" ")}
                    disabled={blocked || saving || recording}
                    title={blocked ? "与系统冲突，不可用" : `使用 ${item}`}
                    onClick={() => {
                      setDraftHotkey(item);
                      setError("");
                      setOkMsg("");
                    }}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? <p className="st-msg is-error">{error}</p> : null}
          {okMsg ? <p className="st-msg is-ok">{okMsg}</p> : null}
        </section>
      </div>
    </div>
  );
}
