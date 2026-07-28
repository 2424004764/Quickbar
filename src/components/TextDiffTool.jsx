/**
 * 文本对比工具：左右粘贴，行级 diff 高亮
 */
import { useMemo, useState } from "react";
import { diffTexts, textsEqual } from "../utils/textDiff";

const DEMO_LEFT = [
  "function greet(name) {",
  '  console.log("hello", name);',
  "  return true;",
  "}",
].join("\n");

const DEMO_RIGHT = [
  "function greet(name) {",
  '  console.log("hi", name);',
  "  // done",
  "  return true;",
  "}",
].join("\n");

export function TextDiffTool() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [viewMode, setViewMode] = useState("side");
  const [copied, setCopied] = useState(false);

  const options = useMemo(
    () => ({ ignoreWhitespace, ignoreCase, trimEnd: true }),
    [ignoreWhitespace, ignoreCase],
  );

  const result = useMemo(
    () => diffTexts(left, right, options),
    [left, right, options],
  );

  const equal = useMemo(
    () => textsEqual(left, right, options),
    [left, right, options],
  );

  function handleSwap() {
    setLeft(right);
    setRight(left);
  }

  function handleDemo() {
    setLeft(DEMO_LEFT);
    setRight(DEMO_RIGHT);
  }

  function handleClear() {
    setLeft("");
    setRight("");
  }

  async function handleCopyUnified() {
    try {
      await navigator.clipboard.writeText(result.unified || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  const hasInput = Boolean(left || right);

  return (
    <div className="pr-diff">
      <div className="pr-diff-actions">
        <button
          type="button"
          className="btn primary"
          onClick={handleDemo}
        >
          填入示例
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleSwap}
          disabled={!hasInput}
        >
          左右互换
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleClear}
          disabled={!hasInput}
        >
          清空
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void handleCopyUnified()}
          disabled={!hasInput}
        >
          复制 Unified Diff
        </button>
        {copied ? <span className="pr-diff-copied">已复制</span> : null}
        <span className="pr-diff-actions-sep" />
        <label className="pr-diff-check">
          <input
            type="checkbox"
            checked={ignoreWhitespace}
            onChange={(e) => setIgnoreWhitespace(e.target.checked)}
          />
          忽略空白
        </label>
        <label className="pr-diff-check">
          <input
            type="checkbox"
            checked={ignoreCase}
            onChange={(e) => setIgnoreCase(e.target.checked)}
          />
          忽略大小写
        </label>
        <span className="pr-diff-actions-sep" />
        <button
          type="button"
          className={["btn", viewMode === "side" ? "is-active" : ""].join(" ")}
          onClick={() => setViewMode("side")}
        >
          并排
        </button>
        <button
          type="button"
          className={["btn", viewMode === "unified" ? "is-active" : ""].join(" ")}
          onClick={() => setViewMode("unified")}
        >
          统一
        </button>
      </div>

      <div className="pr-diff-editors">
        <div className="pr-diff-editor">
          <div className="pr-diff-editor-head">原文 A</div>
          <textarea
            className="pr-diff-textarea"
            data-no-drag
            value={left}
            spellCheck={false}
            placeholder="粘贴原文…"
            onChange={(e) => setLeft(e.target.value)}
          />
        </div>
        <div className="pr-diff-editor">
          <div className="pr-diff-editor-head">对比 B</div>
          <textarea
            className="pr-diff-textarea"
            data-no-drag
            value={right}
            spellCheck={false}
            placeholder="粘贴对比文本…"
            onChange={(e) => setRight(e.target.value)}
          />
        </div>
      </div>

      <div className="pr-diff-stats">
        {!hasInput ? (
          <span>粘贴两侧文本后自动对比</span>
        ) : equal ? (
          <span className="is-ok">两侧文本一致</span>
        ) : (
          <>
            <span className="is-same">相同 {result.stats.same}</span>
            <span className="is-add">新增 {result.stats.add}</span>
            <span className="is-del">删除 {result.stats.del}</span>
          </>
        )}
      </div>

      {hasInput ? (
        viewMode === "side" ? (
          <div className="pr-diff-view">
            <div className="pr-diff-col-head">
              <span>A</span>
              <span>B</span>
            </div>
            <div className="pr-diff-rows">
              {result.rows.map((row, idx) => (
                <div
                  key={`${row.kind}-${row.leftNo}-${row.rightNo}-${idx}`}
                  className={["pr-diff-row", `is-${row.kind}`].join(" ")}
                >
                  <div className="pr-diff-cell is-left">
                    <span className="pr-diff-no">{row.leftNo ?? ""}</span>
                    <pre className="pr-diff-line">{row.left}</pre>
                  </div>
                  <div className="pr-diff-cell is-right">
                    <span className="pr-diff-no">{row.rightNo ?? ""}</span>
                    <pre className="pr-diff-line">{row.right}</pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="pr-diff-unified">
            {result.rows.map((row, idx) => {
              const sign =
                row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
              const text = row.kind === "add" ? row.right : row.left;
              return (
                <div
                  key={`u-${row.kind}-${idx}`}
                  className={["pr-diff-uline", `is-${row.kind}`].join(" ")}
                >
                  <span className="pr-diff-sign">{sign}</span>
                  <pre className="pr-diff-line">{text}</pre>
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}
