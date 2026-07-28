/**
 * Base64 编解码工具
 */
import { useMemo, useState } from "react";
import { decodeBase64, encodeBase64 } from "../utils/base64Codec";

export function Base64Tool() {
  const [source, setSource] = useState("");
  const [urlSafe, setUrlSafe] = useState(false);
  const [mode, setMode] = useState(/** @type {"encode"|"decode"} */ ("encode"));
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    if (!source) {
      return null;
    }
    return mode === "encode"
      ? encodeBase64(source, { urlSafe })
      : decodeBase64(source, { urlSafe });
  }, [source, mode, urlSafe]);

  async function copyOut() {
    if (!result?.ok) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="pr-codec">
      <div className="pr-codec-actions">
        <button
          type="button"
          className={["btn", mode === "encode" ? "primary" : ""].join(" ")}
          onClick={() => setMode("encode")}
        >
          编码
        </button>
        <button
          type="button"
          className={["btn", mode === "decode" ? "primary" : ""].join(" ")}
          onClick={() => setMode("decode")}
        >
          解码
        </button>
        <label className="pr-codec-check">
          <input
            type="checkbox"
            checked={urlSafe}
            onChange={(e) => setUrlSafe(e.target.checked)}
          />
          URL-safe
        </label>
        <button
          type="button"
          className="btn"
          disabled={!result?.ok}
          onClick={() => void copyOut()}
        >
          复制结果
        </button>
        <button
          type="button"
          className="btn"
          disabled={!source}
          onClick={() => setSource("")}
        >
          清空
        </button>
        {copied ? <span className="pr-codec-copied">已复制</span> : null}
      </div>
      <p className="pr-codec-hint">本地 UTF-8 Base64，不上传网络。</p>
      <label className="pr-codec-label">
        {mode === "encode" ? "原文" : "Base64"}
      </label>
      <textarea
        className="pr-codec-input"
        data-no-drag
        value={source}
        spellCheck={false}
        placeholder={mode === "encode" ? "输入文本…" : "粘贴 Base64…"}
        onChange={(e) => setSource(e.target.value)}
      />
      {result && !result.ok ? (
        <p className="pr-codec-error">{result.error}</p>
      ) : null}
      {result?.ok ? (
        <>
          <label className="pr-codec-label">结果</label>
          <pre className="pr-codec-out">{result.value}</pre>
        </>
      ) : null}
    </div>
  );
}
