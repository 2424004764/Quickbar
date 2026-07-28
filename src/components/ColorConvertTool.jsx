/**
 * 颜色转换：HEX / RGB / HSL
 */
import { useMemo, useState } from "react";
import { parseColor } from "../utils/colorConvert";

export function ColorConvertTool() {
  const [source, setSource] = useState("#e5a84b");
  const [copied, setCopied] = useState("");

  const parsed = useMemo(() => parseColor(source), [source]);

  async function copyText(key, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="pr-codec">
      <div className="pr-codec-actions">
        <button
          type="button"
          className="btn"
          onClick={() => setSource("#e5a84b")}
        >
          示例
        </button>
        <input
          className="pr-codec-color"
          data-no-drag
          type="color"
          value={parsed.ok ? parsed.hex : "#e5a84b"}
          onChange={(e) => setSource(e.target.value)}
          title="取色"
        />
        {copied ? (
          <span className="pr-codec-copied">已复制 {copied}</span>
        ) : null}
      </div>
      <p className="pr-codec-hint">
        支持
        {" "}
        <code>#RGB</code>
        /
        <code>#RRGGBB</code>
        、
        <code>rgb()</code>
        、
        <code>hsl()</code>
      </p>
      <label className="pr-codec-label">颜色</label>
      <input
        className="pr-codec-field"
        data-no-drag
        value={source}
        spellCheck={false}
        placeholder="#e5a84b 或 rgb(229, 168, 75)"
        onChange={(e) => setSource(e.target.value)}
      />
      {source && !parsed.ok ? (
        <p className="pr-codec-error">{parsed.error}</p>
      ) : null}
      {parsed.ok ? (
        <>
          <div
            className="pr-codec-swatch"
            style={{ background: parsed.hex }}
            title={parsed.hex}
          />
          <div className="pr-codec-rows">
            {[
              ["HEX", parsed.hex],
              ["RGB", parsed.rgb],
              ["HSL", parsed.hsl],
            ].map(([label, value]) => (
              <div
                key={label}
                className="pr-codec-row"
              >
                <span className="pr-codec-row-label">{label}</span>
                <code className="pr-codec-row-value">{value}</code>
                <button
                  type="button"
                  className="btn pr-codec-copy"
                  onClick={() => void copyText(label, value)}
                >
                  复制
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
