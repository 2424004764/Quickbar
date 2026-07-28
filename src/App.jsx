/**
 * Quickbar 主壳：启动页 + 搜索 + 市场 + 插件（支持会话保留与独立窗）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SearchInput } from "./components/SearchInput";
import { ResultList } from "./components/ResultList";
import { MarketPanel } from "./components/MarketPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { LaunchHome } from "./components/LaunchHome";
import { PluginRunner } from "./components/PluginRunner";
import { WindowDragBar } from "./components/WindowDragBar";
import { useSearch } from "./hooks/useSearch";
import { useTheme } from "./hooks/useTheme";
import {
  addCustomApp,
  hideMainWindow,
  installMarketItem,
  openPath,
  readClipboardLaunchablePath,
  refreshAppIndex,
  runUserCommand,
} from "./pluginApi/api";
import { pushRecent } from "./utils/recentStore";
import { readBootParams } from "./utils/bootParams";
import {
  isWindowDragBlurSuppressed,
  suppressBlurHideFor,
} from "./utils/windowDrag";
import {
  animateMainWindowSize,
  applyMainWindowSize,
  resolveMainWindowSize,
} from "./utils/windowSize";
import "./styles/global.css";

const boot = readBootParams();

export default function App() {
  const [view, setView] = useState(
    boot.view === "plugin" && boot.pluginId ? "plugin" : "search",
  );
  const [pluginId, setPluginId] = useState(boot.pluginId || "");
  const [pluginTitle, setPluginTitle] = useState(boot.pluginTitle || "");
  const [homeKey, setHomeKey] = useState(0);
  /** 首页「最近打开」是否展开（影响主窗高度） */
  const [homeRecentExpanded, setHomeRecentExpanded] = useState(false);
  /** 展开后最近区总行数（窗口按行加高，避免固定加高留白） */
  const [homeRecentExpandRows, setHomeRecentExpandRows] = useState(1);
  const detached = boot.detached;
  const viewRef = useRef(view);
  const queryRef = useRef("");
  const inputRef = useRef(null);
  const homeNavRef = useRef(null);
  const { theme, setTheme } = useTheme();
  const {
    query,
    setQuery,
    results,
    selectedIndex,
    setSelectedIndex,
    loading,
    refresh,
  } = useSearch();

  viewRef.current = view;
  queryRef.current = query;
  const showHome = !query.trim();

  /** 市场/设置保活，避免卸载首页导致图标重载闪烁 */
  const [keepMarket, setKeepMarket] = useState(false);
  const [keepSettings, setKeepSettings] = useState(false);

  /**
   * 切换主界面：内容立刻切换（淡入）+ 窗口高度缓动扩展/收缩
   */
  const goToView = useCallback(
    (nextView) => {
      if (nextView === "market") {
        setKeepMarket(true);
      }
      if (nextView === "settings") {
        setKeepSettings(true);
      }
      setView(nextView);
      if (detached) {
        return;
      }
      const size = resolveMainWindowSize(nextView, {
        showHome: true,
        homeRecentExpanded,
        homeRecentExpandRows,
      });
      // 首页 ↔ 市场/设置：高度缓动；插件页仍瞬时落到目标，避免拖长
      if (
        nextView === "market"
        || nextView === "settings"
        || nextView === "search"
      ) {
        void animateMainWindowSize(size, { durationMs: 200 });
        return;
      }
      void applyMainWindowSize(size);
    },
    [detached, homeRecentExpanded, homeRecentExpandRows],
  );

  // 仅在搜索页内：展开最近 / 有无查询 时调尺寸；跨页切换由 goToView 负责
  useEffect(() => {
    if (detached || viewRef.current !== "search") {
      return;
    }
    void applyMainWindowSize(
      resolveMainWindowSize("search", {
        showHome,
        homeRecentExpanded,
        homeRecentExpandRows,
      }),
    );
  }, [showHome, homeRecentExpanded, homeRecentExpandRows, detached]);

  const handleRecentExpandedChange = useCallback((expanded, meta) => {
    setHomeRecentExpanded(!!expanded);
    if (expanded) {
      setHomeRecentExpandRows(Math.max(1, Number(meta?.rows) || 1));
      return;
    }
    setHomeRecentExpandRows(1);
  }, []);

  // 回到首页时重新选中第一排第一个
  useEffect(() => {
    if (view === "search" && showHome) {
      homeNavRef.current?.selectFirst?.();
    }
  }, [view, showHome, homeKey]);

  const focusSearch = useCallback((options) => {
    const selectAll = options?.select !== false;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (selectAll) {
        inputRef.current?.select?.();
      }
    });
  }, []);

  /** Esc：有内容只清空，不隐藏 */
  const clearSearchQuery = useCallback(() => {
    suppressBlurHideFor(400);
    queryRef.current = "";
    setQuery("");
    focusSearch({ select: false });
  }, [setQuery, focusSearch]);

  /** 重扫本机应用索引后再搜（点「刷新」）；保留当前 query */
  const refreshAppsAndSearch = useCallback(async () => {
    try {
      await refreshAppIndex();
    } catch (err) {
      console.error("refresh app index failed", err);
    }
    await refresh();
    setHomeKey((k) => k + 1);
  }, [refresh]);

  const openPlugin = useCallback(
    (id, title) => {
      setPluginId(id);
      setPluginTitle(title || id);
      goToView("plugin");
    },
    [goToView],
  );

  useEffect(() => {
    let unsubs = [];
    let focusTimer;
    (async () => {
      // 唤起主窗：保留当前查询与结果；延迟聚焦避免 Ctrl+Space 的 Space 冲掉选中文本
      unsubs.push(
        await listen("quickbar://window-shown", () => {
          if (viewRef.current !== "search") {
            return;
          }
          clearTimeout(focusTimer);
          focusTimer = setTimeout(() => {
            focusSearch();
            // 首页：唤起后选中第一排第一个，便于方向键切换
            if (!queryRef.current?.trim()) {
              homeNavRef.current?.selectFirst?.();
            }
          }, 120);
          // 仅后台更新索引，有查询时再静默重搜（不打断当前展示的竞态由 useSearch 序号消化）
          void (async () => {
            try {
              await refreshAppIndex();
            } catch (err) {
              console.error("refresh app index failed", err);
            }
            // 查询为空：尝试用剪贴板里的 exe/lnk 填入搜索（资源管理器 Ctrl+C）
            if (!queryRef.current?.trim()) {
              try {
                const clipPath = await readClipboardLaunchablePath();
                if (clipPath && !queryRef.current?.trim()) {
                  setQuery(clipPath);
                  return;
                }
              } catch (err) {
                console.error("read clipboard launchable path failed", err);
              }
              setHomeKey((k) => k + 1);
              return;
            }
            await refresh();
          })();
        }),
      );
      // 兼容旧事件名
      unsubs.push(
        await listen("quickbar://focus-search", () => {
          if (viewRef.current === "search") {
            focusSearch();
          }
        }),
      );
      unsubs.push(
        await listen("quickbar://open-market", () => {
          goToView("market");
        }),
      );
      unsubs.push(
        await listen("quickbar://open-settings", () => {
          goToView("settings");
        }),
      );
    })();
    return () => {
      clearTimeout(focusTimer);
      unsubs.forEach((u) => u?.());
    };
  }, [focusSearch, refresh, goToView]);

  // 独立插件窗：不因失焦隐藏；主启动器才失焦隐藏
  useEffect(() => {
    if (detached) {
      return undefined;
    }
    let unlisten;
    let timer;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onFocusChanged(({ payload: focused }) => {
        if (focused) {
          return;
        }
        // 拖动窗口时系统会短暂失焦，不能因此隐藏
        if (isWindowDragBlurSuppressed()) {
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (isWindowDragBlurSuppressed()) {
            return;
          }
          void hideMainWindow();
        }, 100);
      });
    })();
    return () => {
      clearTimeout(timer);
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, [detached]);

  useEffect(() => {
    if (view === "search" && !detached) {
      focusSearch();
    }
  }, [view, focusSearch, detached]);

  // Ctrl+D 分离；Esc：搜索有内容只清空；已空才隐藏（保留会话）
  useEffect(() => {
    function onKey(e) {
      if (detached) {
        return;
      }
      if (view === "plugin" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        document.getElementById("qb-detach-btn")?.click();
        return;
      }
      if (e.key !== "Escape") {
        return;
      }
      e.preventDefault();
      if (view === "search" && String(queryRef.current || "").trim()) {
        clearSearchQuery();
        return;
      }
      void hideMainWindow();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, detached, clearSearchQuery]);

  const remember = useCallback((item) => {
    pushRecent({
      id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      kind: item.kind,
      action: item.action,
      payload: item.payload,
      // 不落盘；首页会按 payload 再取图标缓存
      iconDataUrl: item.iconDataUrl,
    });
    setHomeKey((k) => k + 1);
  }, []);

  const activateItem = useCallback(
    async (item) => {
      if (!item) {
        return;
      }
      try {
        if (item.action === "open_path") {
          remember(item);
          await openPath(item.payload);
          await hideMainWindow();
          return;
        }
        if (item.action === "run_command") {
          remember(item);
          await runUserCommand(item.payload);
          await hideMainWindow();
          return;
        }
        if (item.action === "open_market") {
          remember({
            id: "pin:market",
            title: "应用市场",
            kind: "plugin",
            action: "open_market",
            payload: "market",
          });
          goToView("market");
          return;
        }
        if (item.action === "open_settings") {
          remember({
            id: "pin:settings",
            title: "设置",
            subtitle: "Quickbar 配置",
            kind: "action",
            action: "open_settings",
            payload: "settings",
          });
          goToView("settings");
          return;
        }
        if (item.action === "open_plugin") {
          remember({
            id: `plugin:${item.payload}`,
            title: item.title,
            subtitle: item.subtitle,
            kind: "plugin",
            action: "open_plugin",
            payload: item.payload,
          });
          openPlugin(item.payload, item.title);
          return;
        }
        if (item.action === "install_market") {
          await installMarketItem(item.payload);
          remember({
            id: `plugin:${item.payload}`,
            title: item.title,
            subtitle: item.subtitle,
            kind: "plugin",
            action: "open_plugin",
            payload: item.payload,
          });
          openPlugin(item.payload, item.title);
          setHomeKey((k) => k + 1);
          return;
        }
        if (item.action === "add_custom_app") {
          const added = await addCustomApp(item.payload);
          remember({
            id: `local:${added.id}`,
            title: added.name,
            subtitle: added.path,
            kind: "app",
            action: "open_path",
            payload: added.path,
            iconDataUrl: item.iconDataUrl,
          });
          setQuery("");
          setHomeKey((k) => k + 1);
          await refresh();
          return;
        }
        if (item.action === "noop" && item.payload) {
          remember({
            id: `plugin:${item.payload}`,
            title: item.title,
            kind: "plugin",
            action: "open_plugin",
            payload: item.payload,
          });
          openPlugin(item.payload, item.title);
        }
      } catch (err) {
        console.error("activate failed", err);
      }
    },
    [remember, openPlugin, goToView],
  );

  function handleKeyNav(e) {
    if (view !== "search") {
      return;
    }

    // 首页：方向键切换磁贴，Enter 打开（搜索框保持焦点以便继续输入）
    if (showHome) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        homeNavRef.current?.move?.("left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        homeNavRef.current?.move?.("right");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        homeNavRef.current?.move?.("up");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        homeNavRef.current?.move?.("down");
      } else if (e.key === "Enter") {
        e.preventDefault();
        const tile = homeNavRef.current?.getSelected?.();
        if (tile) {
          void activateItem(tile);
        }
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) =>
        results.length ? Math.min(i + 1, results.length - 1) : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
  }

  function backToSearch() {
    goToView("search");
    setQuery("");
    setPluginId("");
    // 不 bump homeKey：首页保活，避免图标与列表整页重载闪一下
  }

  // 独立插件窗：只渲染插件页
  if (detached) {
    return (
      <div className="app-shell is-detached-app">
        <div className="panel is-detached-panel">
          <WindowDragBar />
          <PluginRunner
            pluginId={pluginId}
            title={pluginTitle}
            detached
            onBack={() => void getCurrentWindow().close()}
          />
        </div>
      </div>
    );
  }

  const searchActive = view === "search";
  const marketActive = view === "market";
  const settingsActive = view === "settings";
  const pluginActive = view === "plugin";

  return (
    <div
      className="app-shell"
      onKeyDown={handleKeyNav}
    >
      <div className="panel">
        <WindowDragBar />
        <div
          className={["qb-view", searchActive ? "is-active" : ""].join(" ")}
          aria-hidden={!searchActive}
          inert={!searchActive || undefined}
        >
          <SearchInput
            inputRef={inputRef}
            value={query}
            onChange={setQuery}
            placeholder="搜索应用、命令、插件…"
            onSubmit={() => {
              if (showHome) {
                const tile = homeNavRef.current?.getSelected?.();
                if (tile) {
                  void activateItem(tile);
                }
                return;
              }
              void activateItem(results[selectedIndex]);
            }}
            onEscape={() => {
              if (String(queryRef.current || query).trim()) {
                clearSearchQuery();
                return;
              }
              void hideMainWindow();
            }}
          />
          {showHome ? (
            <>
              <LaunchHome
                ref={homeNavRef}
                refreshKey={homeKey}
                onOpenMarket={() => goToView("market")}
                onActivate={(tile) => void activateItem(tile)}
                onRecentExpandedChange={handleRecentExpandedChange}
              />
              <footer className="footer-bar">
                <span>←↑↓→ 选择 · Enter 打开 · Esc 清空/隐藏</span>
                <span>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => goToView("settings")}
                  >
                    设置
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => goToView("market")}
                  >
                    应用市场
                  </button>
                </span>
              </footer>
            </>
          ) : (
            <>
              <ResultList
                results={results}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                onActivate={(item) => void activateItem(item)}
                loading={loading}
                query={query}
              />
              <footer className="footer-bar">
                <span>↑↓ 选择 · Enter 打开 · Esc 清空/隐藏</span>
                <span>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => goToView("settings")}
                  >
                    设置
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => goToView("market")}
                  >
                    应用市场
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => void refreshAppsAndSearch()}
                  >
                    刷新
                  </button>
                </span>
              </footer>
            </>
          )}
        </div>

        {keepMarket ? (
          <div
            className={["qb-view", marketActive ? "is-active" : ""].join(" ")}
            aria-hidden={!marketActive}
            inert={!marketActive || undefined}
          >
            <MarketPanel onBack={backToSearch} />
          </div>
        ) : null}

        {keepSettings ? (
          <div
            className={["qb-view", settingsActive ? "is-active" : ""].join(" ")}
            aria-hidden={!settingsActive}
            inert={!settingsActive || undefined}
          >
            <SettingsPanel
              theme={theme}
              onThemeChange={setTheme}
              onBack={backToSearch}
            />
          </div>
        ) : null}

        {pluginActive ? (
          <div className="qb-view is-active">
            <PluginRunner
              pluginId={pluginId}
              title={pluginTitle}
              onBack={backToSearch}
              onDetached={backToSearch}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
