/**
 * UUID / 短 ID 生成
 */
import { useMemo, useState } from "react";
import { generateIds } from "../utils/uuidGen";

export function UuidTool() {
  const [kind, setKind] = useState(/** @type {"uuid"|"short"} */ ("uuid"));
  const [count, setCount] = useState(5);
  const [shortBytes, setShortBytes] = useState(8);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState("");

  const list = useMemo(
    () => generateIds(count, kind, shortBytes),
    [count, kind, shortBytes, nonce],
  );

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
          className={["btn", kind === "uuid" ? "primary" : ""].join(" ")}
          onClick={() => setKind("uuid")}
        >
          UUID v4
        </button>
        <button
          type="button"
          className={["btn", kind === "short" ? "primary" : ""].join(" ")}
          onClick={() => setKind("short")}
        >
          短 ID
        </button>
        <label className="pr-codec-inline">
          数量
          <input
            className="pr-codec-num"
            data-no-drag
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
          />
        </label>
        {kind === "short" ? (
          <label className="pr-codec-inline">
            字节
            <input
              className="pr-codec-num"
              data-no-drag
              type="number"
              min={2}
              max={32}
              value={shortBytes}
              onChange={(e) => setShortBytes(Number(e.target.value) || 8)}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="btn primary"
          onClick={() => setNonce((n) => n + 1)}
        >
          重新生成
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void copyText("全部", list.join("\n"))}
        >
          复制全部
        </button>
        {copied ? (
          <span className="pr-codec-copied">已复制 {copied}</span>
        ) : null}
      </div>
      <p className="pr-codec-hint">使用本机密码学随机数，不联网。</p>
      <ul className="pr-codec-list">
        {list.map((id) => (
          <li key={`${id}-${nonce}`}>
            <code>{id}</code>
            <button
              type="button"
              className="btn pr-codec-mini"
              onClick={() => void copyText("ID", id)}
            >
              复制
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
