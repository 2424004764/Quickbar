/**
 * 启动首页：最近打开 / 常用入口 / 发现插件
 * 支持方向键导航：由父组件通过 navRef 调用 move / selectFirst / getSelected
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  getAppIcon,
  getConfig,
  listMarket,
  listPlugins,
} from "../pluginApi/api";
import { isDeadLaunchTile, isDeadPlugin } from "../utils/deadEntries";
import {
  firstHomeTile,
  moveHomeSelection,
  tileNavKey,
} from "../utils/homeNav";
import {
  resolveBuiltinTileIcon,
  withBuiltinIcons,
} from "../utils/hostIcons";
import {
  applyMemoryIcons,
  getCachedAppIcon,
  setCachedAppIcon,
} from "../utils/iconMemoryCache";
import {
  getHomeLaunchCache,
  setHomeLaunchCache,
} from "../utils/homeLaunchCache";
import { setMarketCache } from "../utils/marketCache";
import {
  RECENT_MAX,
  isAppPathTile,
  loadRecent,
  removeRecent,
} from "../utils/recentStore";
import { toneForTile } from "../utils/tileTone";

/**
 * @typedef {object} LaunchTile
 * @property {string} id
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} kind
 * @property {string} action
 * @property {string} payload
 * @property {string} [tone]
 * @property {string} [iconDataUrl]
 * @property {boolean} [iconPending] 本机应用图标加载中
 */

/**
 * @param {{
 *   title?: string,
 *   tone?: string,
 *   iconDataUrl?: string,
 *   iconPending?: boolean,
 * }} props
 */
function TileAvatar({ title, tone, iconDataUrl, iconPending }) {
  if (iconDataUrl) {
    return (
      <img
        className="lp-avatar lp-avatar-img"
        src={iconDataUrl}
        alt=""
        draggable={false}
      />
    );
  }
  if (iconPending) {
    return (
      <span
        className="lp-avatar lp-avatar-pending"
        aria-hidden
      />
    );
  }
  const ch = (title || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={["lp-avatar", tone ? `tone-${tone}` : ""].join(" ")}
      aria-hidden
    >
      {ch}
    </span>
  );
}

/**
 * 为应用磁贴补全图标（走后端缓存）
 * @param {LaunchTile[]} tiles
 * @returns {Promise<LaunchTile[]>}
 */
async function withAppIcons(tiles) {
  const seeded = applyMemoryIcons(withBuiltinIcons(tiles));
  const need = seeded.filter(
    (t) =>
      isAppPathTile(t)
      && t.payload
      && !t.iconDataUrl
      && !resolveBuiltinTileIcon(t),
  );
  if (need.length === 0) {
    return seeded;
  }
  const entries = await Promise.all(
    need.map(async (t) => {
      try {
        const url = await getAppIcon(t.payload);
        if (url) {
          setCachedAppIcon(t.payload, url);
        }
        return [t.id, url || ""];
      } catch {
        return [t.id, ""];
      }
    }),
  );
  /** @type {Record<string, string>} */
  const map = Object.fromEntries(entries);
  return seeded.map((t) =>
    map[t.id] ? { ...t, iconDataUrl: map[t.id] } : t,
  );
}

/** 首帧：同步可用图标（宿主 + 内存），应用缺图标时 pending 不闪字母 */
function seedHomeTiles(tiles) {
  return applyMemoryIcons(withBuiltinIcons(tiles)).map((t) => {
    if (t.iconDataUrl || !isAppPathTile(t)) {
      return t;
    }
    const mem = getCachedAppIcon(t.payload);
    if (mem) {
      return { ...t, iconDataUrl: mem };
    }
    return { ...t, iconPending: true };
  });
}

/** 磁贴最小占位（与均分列宽下限大致对齐），用于估算一行列数 */
const TILE_COL_MIN = 64;

/**
 * @param {number} width
 * @returns {number}
 */
function calcRecentCols(width) {
  if (!width || width < 1) {
    return 9;
  }
  return Math.max(1, Math.floor(width / TILE_COL_MIN));
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} cols
 * @returns {T[][]}
 */
function chunkByCols(items, cols) {
  const size = Math.max(1, cols);
  /** @type {T[][]} */
  const rows = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows.length ? rows : [[]];
}

/**
 * @param {{
 *   tiles: LaunchTile[],
 *   selectedKey?: string,
 *   onSelect: (tile: LaunchTile) => void,
 *   onActivate: (tile: LaunchTile) => void,
 *   onContextMenu?: (tile: LaunchTile, e: import("react").MouseEvent) => void,
 *   cols?: number,
 * }} props
 */
function TileGrid({
  tiles,
  selectedKey,
  onSelect,
  onActivate,
  onContextMenu,
  cols = 9,
}) {
  if (!tiles.length) {
    return <div className="lp-empty">暂无</div>;
  }
  // 满行均分铺满宽度；不满行按个数密排，避免两三个图标被拉得很开
  const fillRow = tiles.length >= cols;
  const colCount = fillRow ? cols : Math.max(1, tiles.length);
  return (
    <ul
      className={["lp-grid", fillRow ? "is-fill" : "is-compact"].join(" ")}
      style={{ "--lp-cols": String(colCount) }}
    >
      {tiles.map((tile) => {
        const key = tileNavKey(tile);
        return (
          <li key={key}>
            <button
              type="button"
              data-nav-key={key}
              className={[
                "lp-tile",
                selectedKey === key ? "is-active" : "",
              ].join(" ")}
              title={tile.subtitle || tile.title}
              onMouseEnter={() => onSelect(tile)}
              onClick={() => onActivate(tile)}
              onContextMenu={(e) => {
                if (!onContextMenu) {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                onSelect(tile);
                onContextMenu(tile, e);
              }}
            >
              <TileAvatar
                title={tile.title}
                tone={toneForTile(tile)}
                iconDataUrl={tile.iconDataUrl}
                iconPending={tile.iconPending && !tile.iconDataUrl}
              />
              <span className="lp-tile-label">{tile.title}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 最近项右键菜单（挂到 body，避免被滚动区裁切）
 * @param {{
 *   x: number,
 *   y: number,
 *   onRemove: () => void,
 *   onClose: () => void,
 * }} props
 */
function RecentTileContextMenu({ x, y, onRemove, onClose }) {
  const menuRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const left = Math.min(
      Math.max(pad, x),
      window.innerWidth - rect.width - pad,
    );
    const top = Math.min(
      Math.max(pad, y),
      window.innerHeight - rect.height - pad,
    );
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        // 先关菜单，勿继续冒泡到 App 的 Esc 隐藏
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onPointer = (e) => {
      const t = e.target;
      if (t instanceof Node && menuRef.current?.contains(t)) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="lp-ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      <button
        type="button"
        className="lp-ctx-item is-danger"
        role="menuitem"
        onClick={() => {
          onRemove();
          onClose();
        }}
      >
        从使用记录中删除
      </button>
    </div>,
    document.body,
  );
}

/**
 * @typedef {{
 *   selectFirst: () => void,
 *   move: (dir: "left"|"right"|"up"|"down") => void,
 *   getSelected: () => LaunchTile | null,
 * }} HomeNavHandle
 */

/**
 * @param {{
 *   onActivate: (tile: LaunchTile) => void,
 *   onOpenMarket: () => void,
 *   refreshKey?: number,
 *   onRecentExpandedChange?: (
 *     expanded: boolean,
 *     meta?: { rows: number },
 *   ) => void,
 * }} props
 * @param {import("react").Ref<HomeNavHandle>} ref
 */
function LaunchHomeInner(
  { onActivate, onOpenMarket, refreshKey = 0, onRecentExpandedChange },
  ref,
) {
  const bootCache = getHomeLaunchCache();
  const [recent, setRecent] = useState(() =>
    seedHomeTiles(loadRecent()).slice(0, RECENT_MAX),
  );
  const [pinned, setPinned] = useState(() => bootCache?.pinned || []);
  const [picks, setPicks] = useState(() => bootCache?.picks || []);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  /** 最近一排可容纳的列数（随容器宽度变化） */
  const [recentCols, setRecentCols] = useState(9);
  /** 最近项右键菜单：屏幕坐标 + 目标磁贴 */
  const [recentMenu, setRecentMenu] = useState(
    /** @type {{ x: number, y: number, tile: LaunchTile } | null} */ (null),
  );
  const recentPanelRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  const closeRecentMenu = useCallback(() => {
    setRecentMenu(null);
  }, []);

  const handleRecentContextMenu = useCallback((tile, e) => {
    setRecentMenu({
      x: e.clientX,
      y: e.clientY,
      tile,
    });
  }, []);

  const handleRemoveRecent = useCallback(() => {
    const tile = recentMenu?.tile;
    if (!tile?.id) {
      return;
    }
    const next = removeRecent(tile.id).slice(0, RECENT_MAX);
    setRecent(seedHomeTiles(next));
    const removedKey = tileNavKey(tile);
    setSelectedKey((cur) => (cur === removedKey ? "" : cur));
  }, [recentMenu]);

  useEffect(() => {
    const el = recentPanelRef.current;
    if (!el) {
      return undefined;
    }
    const measure = () => {
      setRecentCols(calcRecentCols(el.clientWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    setRecent(seedHomeTiles(loadRecent()).slice(0, RECENT_MAX));
    let cancelled = false;
    (async () => {
      try {
        const [plugins, market, config] = await Promise.all([
          listPlugins(),
          listMarket(),
          getConfig(),
        ]);
        if (cancelled) {
          return;
        }

        // 预填市场缓存，进入应用市场时不再整页转圈
        setMarketCache({
          marketItems: Array.isArray(market) ? market : [],
          installed: Array.isArray(plugins) ? plugins : [],
          marketBaseUrl: String(config?.marketBaseUrl || "").trim(),
        });

        /** @type {LaunchTile[]} */
        const pinTiles = withBuiltinIcons([
          {
            id: "pin:market",
            title: "应用市场",
            subtitle: "浏览并安装插件",
            kind: "plugin",
            action: "open_market",
            payload: "market",
          },
        ]);

        for (const p of plugins || []) {
          const id = p.manifest?.id;
          const name = p.manifest?.name || id;
          if (!id || id === "market" || isDeadPlugin(id)) {
            continue;
          }
          pinTiles.push({
            id: `plugin:${id}`,
            title: name,
            subtitle: p.manifest?.description || "",
            kind: "plugin",
            action: "open_plugin",
            payload: id,
          });
        }

        for (const cmd of config?.commands || []) {
          const tile = {
            id: `pin:cmd:${cmd.id}`,
            title: cmd.name || cmd.id,
            subtitle: cmd.command,
            kind: "command",
            action: "run_command",
            payload: cmd.id,
          };
          if (!isDeadLaunchTile(tile)) {
            pinTiles.push(tile);
          }
        }

        for (const app of config?.customApps || []) {
          if (!app?.path) {
            continue;
          }
          pinTiles.push({
            id: `local:${app.id}`,
            title: app.name || app.id,
            subtitle: app.path,
            kind: "app",
            action: "open_path",
            payload: app.path,
          });
        }

        const pinWithIcons = await withAppIcons(
          pinTiles.filter((t) => !isDeadLaunchTile(t)).slice(0, 10),
        );

        // 首页只展示一行，超出通过「更多」进应用市场
        const marketTiles = (market || [])
          .filter((m) => !isDeadPlugin(m.id))
          .map((m) => ({
            id: `plugin:${m.id}`,
            title: m.name,
            subtitle: m.description,
            kind: "plugin",
            action: m.installed ? "open_plugin" : "install_market",
            payload: m.id,
          }));

        if (!cancelled) {
          setPinned(pinWithIcons);
          setPicks(marketTiles);
          setHomeLaunchCache({
            pinned: pinWithIcons,
            picks: marketTiles,
          });
        }

        const recentTiles = loadRecent().slice(0, RECENT_MAX);
        const withIcons = await withAppIcons(recentTiles);
        if (!cancelled) {
          setRecent(withIcons.slice(0, RECENT_MAX));
        }
      } catch (err) {
        console.error("launch home load failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // 收起：只展示一行；展开：全部最近项（由面板内滚动承载）
  const recentShown = useMemo(() => {
    if (recentExpanded) {
      return recent;
    }
    return recent.slice(0, recentCols);
  }, [recent, recentExpanded, recentCols]);

  const canExpandRecent = recent.length > recentCols;

  // 发现插件：默认一行，超出进应用市场
  const picksShown = useMemo(
    () => picks.slice(0, recentCols),
    [picks, recentCols],
  );
  const hasMorePicks = picks.length > picksShown.length;

  // 窗口变宽后一行能放下全部时，自动收起
  useEffect(() => {
    if (!canExpandRecent && recentExpanded) {
      setRecentExpanded(false);
    }
  }, [canExpandRecent, recentExpanded]);

  // 通知父级：是否展开 + 行数，便于按行加高窗口（不多留底部空白）
  useEffect(() => {
    const cols = Math.max(1, recentCols);
    const rows = Math.max(1, Math.ceil(recent.length / cols));
    onRecentExpandedChange?.(recentExpanded, { rows });
  }, [recentExpanded, recent.length, recentCols, onRecentExpandedChange]);

  // 卸载时收回展开态，避免窗口高度残留
  useEffect(() => {
    return () => {
      onRecentExpandedChange?.(false, { rows: 1 });
    };
  }, [onRecentExpandedChange]);

  const navRows = useMemo(() => {
    // 分区前缀保证同应用在多行时选中键唯一，避免同时高亮
    const withKeys = (prefix, tiles) =>
      tiles.map((tile) => ({
        ...tile,
        navKey: `${prefix}:${tile.id}`,
      }));
    const recentKeyed = withKeys("recent", recentShown);
    // 展开后按列切成多行，方向键可在最近区域内上下移动
    const recentNavRows = recentExpanded
      ? chunkByCols(recentKeyed, recentCols)
      : [recentKeyed];
    return [
      ...recentNavRows,
      withKeys("pinned", pinned),
      withKeys("picks", picksShown),
    ];
  }, [recentShown, recentExpanded, recentCols, pinned, picksShown]);

  /** 最近区实际渲染用的扁平列表（与 nav 同源） */
  const recentTilesForGrid = useMemo(() => {
    const withKeys = (tiles) =>
      tiles.map((tile) => ({
        ...tile,
        navKey: `recent:${tile.id}`,
      }));
    return withKeys(recentShown);
  }, [recentShown]);

  const tileByKey = useMemo(() => {
    /** @type {Map<string, LaunchTile>} */
    const map = new Map();
    for (const row of navRows) {
      for (const tile of row) {
        map.set(tileNavKey(tile), tile);
      }
    }
    return map;
  }, [navRows]);

  // 数据变化后：无选中或选中已失效时，落到第一排第一个
  useEffect(() => {
    const first = firstHomeTile(navRows);
    if (!first) {
      setSelectedKey("");
      return;
    }
    if (!selectedKey || !tileByKey.has(selectedKey)) {
      setSelectedKey(tileNavKey(first));
    }
  }, [navRows, tileByKey, selectedKey]);

  // 展开滚动区内：选中项滚入可视范围
  useEffect(() => {
    if (!recentExpanded || !selectedKey.startsWith("recent:")) {
      return;
    }
    const panel = recentPanelRef.current;
    if (!panel) {
      return;
    }
    const btn = Array.from(panel.querySelectorAll("[data-nav-key]")).find(
      (el) => el.getAttribute("data-nav-key") === selectedKey,
    );
    if (btn && typeof btn.scrollIntoView === "function") {
      btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedKey, recentExpanded]);

  useImperativeHandle(
    ref,
    () => ({
      selectFirst() {
        const first = firstHomeTile(navRows);
        if (first) {
          setSelectedKey(tileNavKey(first));
        }
      },
      move(direction) {
        setSelectedKey(
          (cur) => moveHomeSelection(navRows, cur, direction) || cur,
        );
      },
      getSelected() {
        if (!selectedKey) {
          return firstHomeTile(navRows);
        }
        return tileByKey.get(selectedKey) || firstHomeTile(navRows);
      },
    }),
    [navRows, selectedKey, tileByKey],
  );

  return (
    <div className="lp-home">
      <section className="lp-section">
        <div className="lp-section-head">
          <h3>最近打开</h3>
          {canExpandRecent ? (
            <button
              type="button"
              className="lp-section-action"
              onClick={() => setRecentExpanded((v) => !v)}
            >
              {recentExpanded ? "收起" : `展开 (${recent.length})`}
            </button>
          ) : null}
        </div>
        <div
          ref={recentPanelRef}
          className={[
            "lp-recent-panel",
            recentExpanded ? "is-expanded" : "is-collapsed",
          ].join(" ")}
        >
          <TileGrid
            tiles={recentTilesForGrid}
            cols={recentCols}
            selectedKey={selectedKey}
            onSelect={(tile) => setSelectedKey(tileNavKey(tile))}
            onActivate={onActivate}
            onContextMenu={handleRecentContextMenu}
          />
        </div>
      </section>

      {recentMenu ? (
        <RecentTileContextMenu
          x={recentMenu.x}
          y={recentMenu.y}
          onRemove={handleRemoveRecent}
          onClose={closeRecentMenu}
        />
      ) : null}

      <section className="lp-section">
        <div className="lp-section-head">
          <h3>常用入口</h3>
          <button
            type="button"
            className="lp-section-action"
            onClick={onOpenMarket}
          >
            浏览市场
          </button>
        </div>
        <TileGrid
          tiles={pinned.map((tile) => ({
            ...tile,
            navKey: `pinned:${tile.id}`,
          }))}
          cols={recentCols}
          selectedKey={selectedKey}
          onSelect={(tile) => setSelectedKey(tileNavKey(tile))}
          onActivate={onActivate}
        />
      </section>

      <section className="lp-section">
        <div className="lp-section-head">
          <h3>发现插件</h3>
          {hasMorePicks ? (
            <button
              type="button"
              className="lp-section-action"
              onClick={onOpenMarket}
            >
              {`更多 (${picks.length})`}
            </button>
          ) : null}
        </div>
        <TileGrid
          tiles={picksShown.map((tile) => ({
            ...tile,
            navKey: `picks:${tile.id}`,
          }))}
          cols={recentCols}
          selectedKey={selectedKey}
          onSelect={(tile) => setSelectedKey(tileNavKey(tile))}
          onActivate={onActivate}
        />
      </section>
    </div>
  );
}

export const LaunchHome = forwardRef(LaunchHomeInner);
