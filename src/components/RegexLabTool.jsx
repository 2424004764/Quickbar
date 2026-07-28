/**
 * 正则测试：匹配列表 + 替换预览
 */
import { useMemo, useState } from "react";
import {
  buildRegex,
  listMatches,
  replaceAllPreview,
} from "../utils/regexLab";

export function RegexLabTool() {
  const [pattern, setPattern] = useState("\\w+");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("Hello Quickbar 123");
  const [replacement, setReplacement] = useState("[$&]");
  const [copied, setCopied] = useState(false);

  const built = useMemo(() => buildRegex(pattern, flags), [pattern, flags]);
  const matches = useMemo(() => {
    if (!built.ok) {
      return [];
    }
    return listMatches(text, built.regex);
  }, [built, text]);
  const replaced = useMemo(() => {
    if (!built.ok) {
      return "";
    }
    return replaceAllPreview(text, built.regex, replacement);
  }, [built, text, replacement]);

  async function copyReplaced() {
    try {
      await navigator.clipboard.writeText(replaced);
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
          className="btn"
          onClick={() => {
            setPattern("\\w+");
            setFlags("g");
            setText("Hello Quickbar 123");
            setReplacement("[$&]");
          }}
        >
          示例
        </button>
        <button
          type="button"
          className="btn"
          disabled={!built.ok}
          onClick={() => void copyReplaced()}
        >
          复制替换结果
        </button>
        {copied ? <span className="pr-codec-copied">已复制</span> : null}
      </div>
      <div className="pr-codec-regex-row">
        <label className="pr-codec-inline grow">
          正则
          <input
            className="pr-codec-field"
            data-no-drag
            value={pattern}
            spellCheck={false}
            onChange={(e) => setPattern(e.target.value)}
          />
        </label>
        <label className="pr-codec-inline">
          标志
          <input
            className="pr-codec-flags"
            data-no-drag
            value={flags}
            spellCheck={false}
            placeholder="gimsuy"
            onChange={(e) => setFlags(e.target.value)}
          />
        </label>
      </div>
      {!built.ok ? <p className="pr-codec-error">{built.error}</p> : null}
      <label className="pr-codec-label">测试文本</label>
      <textarea
        className="pr-codec-input"
        data-no-drag
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <label className="pr-codec-label">替换为</label>
      <input
        className="pr-codec-field"
        data-no-drag
        value={replacement}
        spellCheck={false}
        onChange={(e) => setReplacement(e.target.value)}
      />
      {built.ok ? (
        <>
          <p className="pr-codec-hint">
            匹配
            {" "}
            {matches.length}
            {" "}
            处
            {matches.length >= 200 ? "（已截断）" : ""}
          </p>
          <ul className="pr-codec-list compact">
            {matches.map((m, i) => (
              <li key={`${m.index}-${i}`}>
                <code>
                  [
                  {m.index}
                  ]
                  {" "}
                  {m.match}
                  {m.groups.length
                    ? ` · groups: ${m.groups.join(", ")}`
                    : ""}
                </code>
              </li>
            ))}
          </ul>
          <label className="pr-codec-label">替换预览</label>
          <pre className="pr-codec-out">{replaced}</pre>
        </>
      ) : null}
    </div>
  );
}
