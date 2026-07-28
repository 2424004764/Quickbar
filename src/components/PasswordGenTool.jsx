/**
 * 随机密码工具：长度 / 字符类型 / 排除易混淆 / 批量生成与复制
 */
import { useMemo, useState } from "react";
import {
  generatePassword,
  generatePasswords,
  STRENGTH_LABEL,
} from "../utils/passwordGen";

const DEFAULT_OPTS = {
  length: 16,
  lower: true,
  upper: true,
  digit: true,
  symbol: true,
  excludeAmbiguous: true,
};

function initialPassword() {
  const r = generatePassword(DEFAULT_OPTS);
  if (!r.ok) {
    return { password: "", strength: "", entropyBits: 0, error: r.error || "" };
  }
  return {
    password: r.password || "",
    strength: r.strength || "",
    entropyBits: r.entropyBits || 0,
    error: "",
  };
}

export function PasswordGenTool() {
  const boot = useMemo(() => initialPassword(), []);
  const [length, setLength] = useState(DEFAULT_OPTS.length);
  const [lower, setLower] = useState(DEFAULT_OPTS.lower);
  const [upper, setUpper] = useState(DEFAULT_OPTS.upper);
  const [digit, setDigit] = useState(DEFAULT_OPTS.digit);
  const [symbol, setSymbol] = useState(DEFAULT_OPTS.symbol);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(
    DEFAULT_OPTS.excludeAmbiguous,
  );
  const [count, setCount] = useState(1);
  const [password, setPassword] = useState(boot.password);
  const [batch, setBatch] = useState(/** @type {string[]} */ ([]));
  const [error, setError] = useState(boot.error);
  const [strength, setStrength] = useState(boot.strength);
  const [entropyBits, setEntropyBits] = useState(boot.entropyBits);
  const [copied, setCopied] = useState("");

  const opts = useMemo(
    () => ({ length, lower, upper, digit, symbol, excludeAmbiguous }),
    [length, lower, upper, digit, symbol, excludeAmbiguous],
  );

  function applyResult(result) {
    if (!result.ok) {
      setError(result.error || "生成失败");
      setPassword("");
      setStrength("");
      setEntropyBits(0);
      return false;
    }
    setError("");
    setPassword(result.password || "");
    setStrength(result.strength || "");
    setEntropyBits(result.entropyBits || 0);
    return true;
  }

  function handleGenerate() {
    const result = generatePassword(opts);
    if (applyResult(result)) {
      setBatch([]);
    }
  }

  function handleBatch() {
    const list = generatePasswords(opts, count);
    const first = list[0];
    if (!first?.ok) {
      applyResult(first || { ok: false, error: "生成失败" });
      setBatch([]);
      return;
    }
    applyResult(first);
    setBatch(list.filter((x) => x.ok).map((x) => x.password || ""));
  }

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
    <div className="pr-pwd">
      <div className="pr-pwd-actions">
        <button
          type="button"
          className="btn primary"
          onClick={handleGenerate}
        >
          生成
        </button>
        <button
          type="button"
          className="btn"
          disabled={!password}
          onClick={() => void copyText("密码", password)}
        >
          复制
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleBatch}
        >
          批量生成
        </button>
        {copied ? <span className="pr-pwd-copied">已复制</span> : null}
      </div>

      <div className="pr-pwd-output">
        <code className="pr-pwd-value">{password || "—"}</code>
        {strength ? (
          <span className={["pr-pwd-strength", `is-${strength}`].join(" ")}>
            {STRENGTH_LABEL[strength] || strength}
            <span className="pr-pwd-entropy">≈ {entropyBits} bit</span>
          </span>
        ) : null}
      </div>
      {error ? <p className="pr-pwd-error">{error}</p> : null}

      <div className="pr-pwd-opts">
        <label className="pr-pwd-length">
          <span>长度 {length}</span>
          <input
            type="range"
            min={4}
            max={64}
            value={length}
            data-no-drag
            onChange={(e) => setLength(Number(e.target.value))}
          />
        </label>
        <label className="pr-pwd-check">
          <input
            type="checkbox"
            checked={lower}
            onChange={(e) => setLower(e.target.checked)}
          />
          小写 a-z
        </label>
        <label className="pr-pwd-check">
          <input
            type="checkbox"
            checked={upper}
            onChange={(e) => setUpper(e.target.checked)}
          />
          大写 A-Z
        </label>
        <label className="pr-pwd-check">
          <input
            type="checkbox"
            checked={digit}
            onChange={(e) => setDigit(e.target.checked)}
          />
          数字 0-9
        </label>
        <label className="pr-pwd-check">
          <input
            type="checkbox"
            checked={symbol}
            onChange={(e) => setSymbol(e.target.checked)}
          />
          符号
        </label>
        <label className="pr-pwd-check">
          <input
            type="checkbox"
            checked={excludeAmbiguous}
            onChange={(e) => setExcludeAmbiguous(e.target.checked)}
          />
          排除易混淆（0OIl1）
        </label>
        <label className="pr-pwd-count">
          批量数量
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            data-no-drag
            onChange={(e) => setCount(Number(e.target.value) || 1)}
          />
        </label>
      </div>

      {batch.length > 1 ? (
        <div className="pr-pwd-batch">
          <div className="pr-pwd-batch-head">
            <span>批量结果（{batch.length}）</span>
            <button
              type="button"
              className="btn"
              onClick={() => void copyText("批量", batch.join("\n"))}
            >
              全部复制
            </button>
          </div>
          <ul className="pr-pwd-batch-list">
            {batch.map((pwd, idx) => (
              <li key={`${pwd}-${idx}`}>
                <code>{pwd}</code>
                <button
                  type="button"
                  className="btn pr-pwd-mini"
                  onClick={() => void copyText(`#${idx + 1}`, pwd)}
                >
                  复制
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
