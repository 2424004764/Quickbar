/**
 * URL 编解码工具
 */
import { useMemo, useState } from "react";
import { decodeUrl, encodeUrl } from "../utils/urlCodec";

export function UrlCodecTool() {
  const [source, setSource] = useState("");
  const [mode, setMode] = useState(/** @type {"encode"|"decode"} */ ("encode"));
  const [uriMode, setUriMode] = useState(
    /** @type {"component"|"uri"} */ ("component"),
  );
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    if (!source) {
      return null;
    }
    return mode === "encode"
      ? encodeUrl(source, uriMode)
      : decodeUrl(source, uriMode);
  }, [source, mode, uriMode]);

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
        <select
          className="pr-codec-select"
          data-no-drag
          value={uriMode}
          onChange={(e) => setUriMode(e.target.value)}
        >
          <option value="component">encodeURIComponent</option>
          <option value="uri">encodeURI（保留 :/?# 等）</option>
        </select>
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
      <p className="pr-codec-hint">
        默认用
        {" "}
        <code>encodeURIComponent</code>
        ，适合 query / 表单值。
      </p>
      <label className="pr-codec-label">输入</label>
      <textarea
        className="pr-codec-input"
        data-no-drag
        value={source}
        spellCheck={false}
        placeholder="例如 https://example.com?q=中文 空格"
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
