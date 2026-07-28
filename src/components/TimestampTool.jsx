/**
 * 时间戳转换工具：秒/毫秒 ↔ 本地/UTC/ISO
 */
import { useEffect, useMemo, useState } from "react";
import {
  nowTimestamps,
  parseDateTime,
  parseTimestamp,
} from "../utils/timestampConvert";

/**
 * @param {{ label: string, value: string, onCopy?: () => void }} props
 */
function ResultRow({ label, value, onCopy }) {
  return (
    <div className="pr-ts-row">
      <span className="pr-ts-row-label">{label}</span>
      <code className="pr-ts-row-value">{value || "—"}</code>
      {onCopy && value ? (
        <button
          type="button"
          className="btn pr-ts-copy"
          onClick={onCopy}
        >
          复制
        </button>
      ) : null}
    </div>
  );
}

export function TimestampTool() {
  const [tsInput, setTsInput] = useState("");
  const [unit, setUnit] = useState("auto");
  const [dtInput, setDtInput] = useState("");
  const [copied, setCopied] = useState("");
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const live = useMemo(() => nowTimestamps(tick), [tick]);
  const fromTs = useMemo(
    () => parseTimestamp(tsInput, unit, tick),
    [tsInput, unit, tick],
  );
  const fromDt = useMemo(() => parseDateTime(dtInput), [dtInput]);

  async function copyText(key, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1200);
    } catch {
      // ignore
    }
  }

  function handleFillNow() {
    const n = nowTimestamps();
    setTsInput(String(n.sec));
    setUnit("s");
  }

  function handleFillNowMs() {
    const n = nowTimestamps();
    setTsInput(String(n.ms));
    setUnit("ms");
  }

  function handleFillNowDate() {
    const r = parseTimestamp(String(Date.now()), "ms");
    if (r.ok && r.local) {
      setDtInput(r.local.replace(/\.\d+$/, ""));
    }
  }

  return (
    <div className="pr-ts">
      <div className="pr-ts-live">
        <span>
          当前：
          <code>{live.sec}</code>
          {" · "}
          <code>{live.ms}</code>
        </span>
        {copied ? <span className="pr-ts-copied">已复制 {copied}</span> : null}
      </div>

      <section className="pr-ts-section">
        <div className="pr-ts-section-head">
          <h3>时间戳 → 日期</h3>
          <div className="pr-ts-actions">
            <button
              type="button"
              className="btn"
              onClick={handleFillNow}
            >
              填入当前秒
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleFillNowMs}
            >
              填入当前毫秒
            </button>
            <button
              type="button"
              className="btn"
              disabled={!tsInput}
              onClick={() => setTsInput("")}
            >
              清空
            </button>
          </div>
        </div>
        <div className="pr-ts-input-row">
          <input
            className="pr-ts-input"
            data-no-drag
            value={tsInput}
            spellCheck={false}
            placeholder="例如 1700000000 或 1700000000000"
            onChange={(e) => setTsInput(e.target.value)}
          />
          <select
            className="pr-ts-select"
            data-no-drag
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="auto">自动</option>
            <option value="s">秒</option>
            <option value="ms">毫秒</option>
          </select>
        </div>
        {tsInput && !fromTs.ok ? (
          <p className="pr-ts-error">{fromTs.error}</p>
        ) : null}
        {fromTs.ok ? (
          <div className="pr-ts-results">
            <ResultRow
              label="识别单位"
              value={fromTs.detectedUnit === "ms" ? "毫秒" : "秒"}
            />
            <ResultRow
              label="秒"
              value={String(fromTs.sec)}
              onCopy={() => void copyText("秒", String(fromTs.sec))}
            />
            <ResultRow
              label="毫秒"
              value={String(fromTs.ms)}
              onCopy={() => void copyText("毫秒", String(fromTs.ms))}
            />
            <ResultRow
              label="本地"
              value={fromTs.local || ""}
              onCopy={() => void copyText("本地", fromTs.local || "")}
            />
            <ResultRow
              label="UTC"
              value={fromTs.utc || ""}
              onCopy={() => void copyText("UTC", fromTs.utc || "")}
            />
            <ResultRow
              label="ISO"
              value={fromTs.iso || ""}
              onCopy={() => void copyText("ISO", fromTs.iso || "")}
            />
            <ResultRow
              label="相对"
              value={fromTs.relative || ""}
            />
          </div>
        ) : null}
      </section>

      <section className="pr-ts-section">
        <div className="pr-ts-section-head">
          <h3>日期 → 时间戳</h3>
          <div className="pr-ts-actions">
            <button
              type="button"
              className="btn"
              onClick={handleFillNowDate}
            >
              填入当前时间
            </button>
            <button
              type="button"
              className="btn"
              disabled={!dtInput}
              onClick={() => setDtInput("")}
            >
              清空
            </button>
          </div>
        </div>
        <input
          className="pr-ts-input"
          data-no-drag
          value={dtInput}
          spellCheck={false}
          placeholder="例如 2023-11-14 22:13:20 或 ISO"
          onChange={(e) => setDtInput(e.target.value)}
        />
        <p className="pr-ts-hint">
          支持 ISO、
          <code>YYYY-MM-DD HH:mm:ss</code>
          、斜杠日期等
        </p>
        {dtInput && !fromDt.ok ? (
          <p className="pr-ts-error">{fromDt.error}</p>
        ) : null}
        {fromDt.ok ? (
          <div className="pr-ts-results">
            <ResultRow
              label="秒"
              value={String(fromDt.sec)}
              onCopy={() => void copyText("秒", String(fromDt.sec))}
            />
            <ResultRow
              label="毫秒"
              value={String(fromDt.ms)}
              onCopy={() => void copyText("毫秒", String(fromDt.ms))}
            />
            <ResultRow
              label="本地"
              value={fromDt.local || ""}
              onCopy={() => void copyText("本地", fromDt.local || "")}
            />
            <ResultRow
              label="UTC"
              value={fromDt.utc || ""}
              onCopy={() => void copyText("UTC", fromDt.utc || "")}
            />
            <ResultRow
              label="ISO"
              value={fromDt.iso || ""}
              onCopy={() => void copyText("ISO", fromDt.iso || "")}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
