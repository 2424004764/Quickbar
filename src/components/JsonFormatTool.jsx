/**
 * JSON 格式化工具：文本编辑 + 树形折叠/展开 + this 过滤
 */
import { useMemo, useState } from "react";
import {
  applyJsonFilter,
  collectFoldablePaths,
  stringifyJsonResult,
} from "../utils/jsonFilter";

const JSON_FILTER_EXAMPLES = [
  { label: ".key.subkey", expr: ".key.subkey" },
  { label: "[0]", expr: "[0]" },
  { label: ".items.map(x=>x.val)", expr: ".items.map(x=>x.val)" },
];

const JSON_DEMO = `{
  "hello": "quickbar",
  "key": {
    "subkey": "nested-value"
  },
  "items": [
    { "val": 1, "name": "a" },
    { "val": 2, "name": "b" }
  ]
}`;

function previewCollapsed(value) {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value !== null && typeof value === "object") {
    return `Object(${Object.keys(value).length})`;
  }
  return "";
}

/**
 * @param {{
 *   name?: string | number | null,
 *   value: unknown,
 *   path: string,
 *   collapsed: Set<string>,
 *   onToggle: (path: string) => void,
 *   isLast?: boolean,
 * }} props
 */
function JsonTreeNode({
  name,
  value,
  path,
  collapsed,
  onToggle,
  isLast = true,
}) {
  const isContainer = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const isCollapsed = isContainer && collapsed.has(path);
  const keys = isContainer
    ? isArray
      ? value.map((_, i) => i)
      : Object.keys(value)
    : [];

  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const comma = isLast ? "" : ",";

  if (!isContainer) {
    return (
      <div className="jt-line">
        {name !== null && name !== undefined ? (
          <>
            <span className="jt-key">{JSON.stringify(String(name))}</span>
            <span className="jt-colon">: </span>
          </>
        ) : null}
        <JsonPrimitive value={value} />
        <span className="jt-punct">{comma}</span>
      </div>
    );
  }

  return (
    <div className="jt-node">
      <div className="jt-line">
        <button
          type="button"
          className="jt-toggle"
          aria-label={isCollapsed ? "展开" : "折叠"}
          onClick={() => onToggle(path)}
        >
          {isCollapsed ? "▶" : "▼"}
        </button>
        {name !== null && name !== undefined ? (
          <>
            <span className="jt-key">{JSON.stringify(String(name))}</span>
            <span className="jt-colon">: </span>
          </>
        ) : null}
        <button
          type="button"
          className="jt-bracket"
          onClick={() => onToggle(path)}
        >
          {openBracket}
        </button>
        {isCollapsed ? (
          <>
            <span className="jt-ellipsis"> … </span>
            <span className="jt-preview">{previewCollapsed(value)}</span>
            <span className="jt-punct">
              {closeBracket}
              {comma}
            </span>
          </>
        ) : keys.length === 0 ? (
          <span className="jt-punct">
            {closeBracket}
            {comma}
          </span>
        ) : null}
      </div>
      {!isCollapsed && keys.length > 0 ? (
        <div className="jt-children">
          {keys.map((key, index) => (
            <JsonTreeNode
              key={`${path}-${key}`}
              name={key}
              value={isArray ? value[key] : value[key]}
              path={isArray ? `${path}[${key}]` : `${path}.${key}`}
              collapsed={collapsed}
              onToggle={onToggle}
              isLast={index === keys.length - 1}
            />
          ))}
          <div className="jt-line">
            <span className="jt-punct">
              {closeBracket}
              {comma}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function JsonPrimitive({ value }) {
  if (value === null) {
    return <span className="jt-null">null</span>;
  }
  if (typeof value === "string") {
    return <span className="jt-string">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="jt-number">{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="jt-bool">{String(value)}</span>;
  }
  return <span className="jt-unknown">{String(value)}</span>;
}

/**
 * @param {{ data: unknown, collapsed: Set<string>, onToggle: (p: string) => void }} props
 */
function JsonTreeView({ data, collapsed, onToggle }) {
  return (
    <div className="jt-view">
      <JsonTreeNode
        name={null}
        value={data}
        path="$"
        collapsed={collapsed}
        onToggle={onToggle}
        isLast
      />
    </div>
  );
}

export function JsonFormatTool() {
  const [source, setSource] = useState(JSON_DEMO);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [filterError, setFilterError] = useState("");
  const [viewMode, setViewMode] = useState("tree"); // text | tree
  /** @type {[Set<string>, function]} */
  const [collapsed, setCollapsed] = useState(() => new Set());

  const filtering = Boolean(filter.trim());

  const parsedView = useMemo(() => {
    try {
      const root = JSON.parse(source);
      if (!filtering) {
        return { ok: true, sourceOk: true, data: root };
      }
      try {
        return {
          ok: true,
          sourceOk: true,
          data: applyJsonFilter(root, filter),
        };
      } catch (err) {
        // 过滤失败时仍展示源树，错误交给 filterError
        return {
          ok: true,
          sourceOk: true,
          data: root,
          filterFailed: true,
          error: String(err?.message || err),
        };
      }
    } catch (err) {
      return {
        ok: false,
        sourceOk: false,
        error: String(err?.message || err),
        data: null,
      };
    }
  }, [source, filter, filtering]);

  /** 文本模式下的展示内容 */
  let display = source;
  if (filtering) {
    if (parsedView.ok) {
      display = stringifyJsonResult(parsedView.data);
    }
  }

  function recomputeFilter(nextFilter, nextSource = source) {
    const expr = String(nextFilter || "").trim();
    if (!expr) {
      setFilterError("");
      return;
    }
    try {
      const data = JSON.parse(nextSource);
      applyJsonFilter(data, expr);
      setFilterError("");
    } catch (err) {
      setFilterError(String(err?.message || err));
    }
  }

  function handleFormat() {
    try {
      const obj = JSON.parse(filtering && parsedView.ok ? display : source);
      const text = JSON.stringify(obj, null, 2);
      setSource(text);
      if (filtering) {
        setFilter("");
        setFilterError("");
      }
      setError("");
      setViewMode("tree");
      setCollapsed(new Set());
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  function handleCompact() {
    try {
      const obj = JSON.parse(filtering && parsedView.ok ? display : source);
      const text = JSON.stringify(obj);
      setSource(text);
      if (filtering) {
        setFilter("");
        setFilterError("");
      }
      setError("");
      setViewMode("text");
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function handleCopy() {
    try {
      const text =
        viewMode === "tree" && parsedView.ok
          ? stringifyJsonResult(parsedView.data)
          : filtering
            ? display
            : source;
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  function handleFilterChange(value) {
    setFilter(value);
    recomputeFilter(value, source);
    setCollapsed(new Set());
  }

  function handleApplyFilterAsSource() {
    if (!filtering || filterError || !parsedView.ok) {
      return;
    }
    setSource(stringifyJsonResult(parsedView.data));
    setFilter("");
    setFilterError("");
    setError("");
    setCollapsed(new Set());
  }

  function handleToggle(path) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function handleExpandAll() {
    setCollapsed(new Set());
  }

  function handleCollapseAll() {
    if (!parsedView.ok) {
      return;
    }
    setCollapsed(new Set(collectFoldablePaths(parsedView.data)));
  }

  const treeAvailable = parsedView.ok;
  const showTree = viewMode === "tree" && treeAvailable;

  return (
    <div className="pr-json">
      <div className="pr-json-actions">
        <button
          type="button"
          className="btn primary"
          onClick={handleFormat}
        >
          格式化
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleCompact}
        >
          压缩
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void handleCopy()}
        >
          复制
        </button>
        <span className="pr-json-actions-sep" />
        <button
          type="button"
          className={["btn", viewMode === "text" ? "is-active" : ""].join(" ")}
          onClick={() => setViewMode("text")}
        >
          文本
        </button>
        <button
          type="button"
          className={["btn", viewMode === "tree" ? "is-active" : ""].join(" ")}
          disabled={!treeAvailable}
          title={treeAvailable ? "树形折叠视图" : "JSON 无效，无法切换树形"}
          onClick={() => {
            if (treeAvailable) {
              setViewMode("tree");
            }
          }}
        >
          树形
        </button>
        {showTree ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={handleExpandAll}
            >
              全部展开
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleCollapseAll}
            >
              全部折叠
            </button>
          </>
        ) : null}
        {filtering ? (
          <button
            type="button"
            className="btn"
            disabled={Boolean(filterError) || !parsedView.ok}
            title="把当前过滤结果写回编辑区"
            onClick={handleApplyFilterAsSource}
          >
            应用结果
          </button>
        ) : null}
      </div>
      {error ? <div className="pr-error">{error}</div> : null}
      {filterError ? (
        <div className="pr-error">过滤失败：{filterError}</div>
      ) : null}
      {viewMode === "tree" && !treeAvailable ? (
        <div className="pr-error">
          当前内容不是合法 JSON，已切到文本模式以便修改：{parsedView.error}
        </div>
      ) : null}

      {showTree ? (
        <JsonTreeView
          data={parsedView.data}
          collapsed={collapsed}
          onToggle={handleToggle}
        />
      ) : (
        <textarea
          className="pr-textarea"
          value={
            viewMode === "tree" && !treeAvailable
              ? source
              : filtering
                ? display
                : source
          }
          readOnly={filtering && treeAvailable}
          onChange={(e) => {
            setSource(e.target.value);
            setError("");
            if (viewMode === "tree") {
              // 无效 JSON 时在文本里改
            }
          }}
          spellCheck={false}
          placeholder="粘贴 JSON；可用树形折叠，下方可 this 过滤"
        />
      )}

      <div className="pr-json-filter">
        <span
          className="pr-json-filter-prefix"
          title="过滤表达式以当前 JSON 为 this"
        >
          this |
        </span>
        <input
          className="pr-json-filter-input"
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleApplyFilterAsSource();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              handleFilterChange("");
            }
          }}
          placeholder='JS 过滤；示例 ".key.subkey"、"[0][1]"、".map(x=>x.val)"'
          spellCheck={false}
        />
        {filtering ? (
          <button
            type="button"
            className="btn ghost pr-json-filter-clear"
            title="清空过滤 Esc"
            onClick={() => handleFilterChange("")}
          >
            清除
          </button>
        ) : null}
      </div>
      <div className="pr-json-filter-tips">
        <span className="pr-json-filter-tips-label">示例</span>
        {JSON_FILTER_EXAMPLES.map((item) => (
          <button
            key={item.expr}
            type="button"
            className="pr-json-chip"
            onClick={() => handleFilterChange(item.expr)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
