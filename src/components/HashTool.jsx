/**
 * 文本 Hash：MD5 / SHA-1 / SHA-256
 */
import { useEffect, useState } from "react";
import { hashTextAll } from "../utils/textHash";

export function HashTool() {
  const [source, setSource] = useState("");
  const [result, setResult] = useState(
    /** @type {null | { ok: true, md5: string, sha1: string, sha256: string } | { ok: false, error: string }} */ (
      null
    ),
  );
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setResult(null);
      return undefined;
    }
    void hashTextAll(source).then((r) => {
      if (!cancelled) {
        setResult(r);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

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
          disabled={!source}
          onClick={() => setSource("")}
        >
          清空
        </button>
        {copied ? (
          <span className="pr-codec-copied">已复制 {copied}</span>
        ) : null}
      </div>
      <p className="pr-codec-hint">
        本地计算；MD5/SHA-1 仅作兼容，敏感场景请用 SHA-256。
      </p>
      <label className="pr-codec-label">文本</label>
      <textarea
        className="pr-codec-input"
        data-no-drag
        value={source}
        spellCheck={false}
        placeholder="输入要摘要的文本…"
        onChange={(e) => setSource(e.target.value)}
      />
      {result && !result.ok ? (
        <p className="pr-codec-error">{result.error}</p>
      ) : null}
      {result?.ok ? (
        <div className="pr-codec-rows">
          {[
            ["MD5", result.md5],
            ["SHA-1", result.sha1],
            ["SHA-256", result.sha256],
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
      ) : null}
    </div>
  );
}
