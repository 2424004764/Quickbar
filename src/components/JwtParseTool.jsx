/**
 * JWT 解析工具：解码 header / payload，展示过期时间（不验签）
 */
import { useMemo, useState } from "react";
import { parseJwt } from "../utils/jwtParse";

const DEMO_HEADER = { alg: "HS256", typ: "JWT" };
const DEMO_PAYLOAD = {
  sub: "1234567890",
  name: "Quickbar Demo",
  iat: Math.floor(Date.now() / 1000) - 60,
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function toB64Url(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const DEMO_JWT = [
  toB64Url(DEMO_HEADER),
  toB64Url(DEMO_PAYLOAD),
  "demo-signature",
].join(".");

export function JwtParseTool() {
  const [source, setSource] = useState("");
  const [copied, setCopied] = useState("");

  const parsed = useMemo(() => parseJwt(source), [source]);

  async function copyText(label, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="pr-jwt">
      <div className="pr-jwt-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => setSource(DEMO_JWT)}
        >
          填入示例
        </button>
        <button
          type="button"
          className="btn"
          disabled={!source}
          onClick={() => setSource("")}
        >
          清空
        </button>
        <button
          type="button"
          className="btn"
          disabled={!parsed.ok}
          onClick={() => void copyText("payload", parsed.payloadText || "")}
        >
          复制 Payload
        </button>
        <button
          type="button"
          className="btn"
          disabled={!parsed.ok}
          onClick={() => void copyText("header", parsed.headerText || "")}
        >
          复制 Header
        </button>
        {copied ? (
          <span className="pr-jwt-copied">已复制 {copied}</span>
        ) : null}
      </div>

      <p className="pr-jwt-hint">
        仅本地 Base64URL 解码，不校验签名。支持粘贴带
        {" "}
        <code>Bearer</code>
        {" "}
        前缀的内容。
      </p>

      <label className="pr-jwt-label">JWT</label>
      <textarea
        className="pr-jwt-input"
        data-no-drag
        value={source}
        placeholder="粘贴 eyJhbGciOi... 或 Bearer eyJ..."
        spellCheck={false}
        onChange={(e) => setSource(e.target.value)}
      />

      {!source.trim() ? null : !parsed.ok ? (
        <div className="pr-error">{parsed.error}</div>
      ) : (
        <>
          {parsed.claims?.length ? (
            <div className="pr-jwt-claims">
              {parsed.claims.map((row) => (
                <div
                  key={row.key}
                  className={[
                    "pr-jwt-claim",
                    row.tone ? `is-${row.tone}` : "",
                  ].join(" ")}
                >
                  <span className="pr-jwt-claim-label">{row.label}</span>
                  <span className="pr-jwt-claim-value">{row.value}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="pr-jwt-grid">
            <section className="pr-jwt-panel">
              <div className="pr-jwt-panel-head">
                <h3>Header</h3>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void copyText("header", parsed.headerText || "")}
                >
                  复制
                </button>
              </div>
              <pre className="pr-jwt-pre">{parsed.headerText}</pre>
            </section>
            <section className="pr-jwt-panel">
              <div className="pr-jwt-panel-head">
                <h3>Payload</h3>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void copyText("payload", parsed.payloadText || "")}
                >
                  复制
                </button>
              </div>
              <pre className="pr-jwt-pre">{parsed.payloadText}</pre>
            </section>
          </div>

          <section className="pr-jwt-panel pr-jwt-sig">
            <div className="pr-jwt-panel-head">
              <h3>Signature（原始，未校验）</h3>
              <button
                type="button"
                className="btn"
                disabled={!parsed.signature}
                onClick={() => void copyText("signature", parsed.signature || "")}
              >
                复制
              </button>
            </div>
            <pre className="pr-jwt-pre is-sig">
              {parsed.signature || "（无签名段）"}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}
