/**
 * 搜索结果：优先应用横向卡片，其余为列表
 */
import { resolveBuiltinTileIcon } from "../utils/hostIcons";

const KIND_LABEL = {
  app: "应用",
  command: "命令",
  plugin: "插件",
  market: "市场",
  action: "操作",
};

/**
 * 高亮标题中与查询匹配的前缀（不区分大小写）
 * @param {string} title
 * @param {string} query
 */
function highlightTitle(title, query) {
  const q = (query || "").trim();
  if (!q || !title) {
    return title;
  }
  const lowerTitle = title.toLowerCase();
  const lowerQ = q.toLowerCase();
  if (lowerTitle.startsWith(lowerQ)) {
    return (
      <>
        <mark className="result-mark">{title.slice(0, q.length)}</mark>
        {title.slice(q.length)}
      </>
    );
  }
  const idx = lowerTitle.indexOf(lowerQ);
  if (idx >= 0) {
    return (
      <>
        {title.slice(0, idx)}
        <mark className="result-mark">
          {title.slice(idx, idx + q.length)}
        </mark>
        {title.slice(idx + q.length)}
      </>
    );
  }
  return title;
}

/**
 * @param {{ item: import("../pluginApi/api").SearchItem }} props
 */
function ResultIcon({ item }) {
  const builtin = item.iconDataUrl || resolveBuiltinTileIcon(item);
  if (builtin) {
    return (
      <img
        className="result-icon-img"
        src={builtin}
        alt=""
        draggable={false}
      />
    );
  }
  const ch = (item.title || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={["result-icon-fallback", `kind-${item.kind || "app"}`].join(
        " ",
      )}
      aria-hidden
    >
      {ch}
    </span>
  );
}

/**
 * @param {{
 *   results: import("../pluginApi/api").SearchItem[],
 *   selectedIndex: number,
 *   onSelect: (index: number) => void,
 *   onActivate: (item: import("../pluginApi/api").SearchItem) => void,
 *   loading?: boolean,
 *   query?: string,
 * }} props
 */
export function ResultList({
  results,
  selectedIndex,
  onSelect,
  onActivate,
  loading = false,
  query = "",
}) {
  if (!loading && results.length === 0) {
    return (
      <div className="result-empty">
        无匹配结果
      </div>
    );
  }

  // 粘贴路径时首条常为「加入本地启动」；其后找应用做优先卡片
  const openAppIndex = results.findIndex((r) => r.kind === "app");
  const featured =
    openAppIndex >= 0
      ? { item: results[openAppIndex], index: openAppIndex }
      : null;
  const listItems = results
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !(featured && index === featured.index));

  return (
    <div className="result-panel">
      {featured ? (
        <section className="result-featured">
          <div className="result-section-label">首选应用</div>
          <button
            type="button"
            className={[
              "result-tile",
              selectedIndex === featured.index ? "is-active" : "",
            ].join(" ")}
            onMouseEnter={() => onSelect(featured.index)}
            onClick={() => onActivate(featured.item)}
          >
            <span className="result-tile-icon">
              <ResultIcon item={featured.item} />
            </span>
            <span className="result-tile-label">
              {highlightTitle(featured.item.title, query)}
            </span>
          </button>
        </section>
      ) : null}

      {listItems.length > 0 ? (
        <section className="result-matches">
          {featured || listItems.some(({ item }) => item.kind === "action") ? (
            <div className="result-section-label">其他匹配</div>
          ) : null}
          <ul
            className="result-list"
            role="listbox"
          >
            {listItems.map(({ item, index }) => {
              const active = index === selectedIndex;
              return (
                <li
                  key={item.id}
                  role="option"
                  aria-selected={active}
                  className={[
                    "result-item",
                    active ? "is-active" : "",
                  ].join(" ")}
                  onMouseEnter={() => onSelect(index)}
                  onClick={() => onActivate(item)}
                >
                  <span className="result-item-icon">
                    <ResultIcon item={item} />
                  </span>
                  <div className="result-main">
                    <div className="result-title">
                      {highlightTitle(item.title, query)}
                    </div>
                    <div className="result-sub">{item.subtitle}</div>
                  </div>
                  <span className="result-kind">
                    {KIND_LABEL[item.kind] || item.kind}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
