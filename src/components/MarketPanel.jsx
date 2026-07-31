/**
 * 应用市场：顶栏 + 全部/已安装分段 + 行列表（无登录）
 * 布局刻意区别于常见启动器商店（无假 Tab、无左栏、无促销 Banner）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getConfig,
  installMarketItem,
  installPluginFromPath,
  listCustomApps,
  listMarket,
  listPlugins,
  openPath,
  isWebUrl,
  removeCustomApp,
  submitMarketPlugin,
  syncCustomAppToMarket,
  uninstallPlugin,
  upsertWebApp,
} from "../pluginApi/api";
import { getMarketCache, setMarketCache } from "../utils/marketCache";
import {
  handleWindowDragMouseDown,
  runWithBlurHideSuspended,
} from "../utils/windowDrag";

/** 名称首字作为图标占位色块 */
function PluginAvatar({ name }) {
  const ch = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className="mk-avatar"
      aria-hidden
    >
      {ch}
    </span>
  );
}

function readInitialMarketState() {
  const cached = getMarketCache();
  if (!cached) {
    return {
      marketItems: [],
      installed: [],
      marketBaseUrl: "",
      hasCache: false,
    };
  }
  return {
    marketItems: cached.marketItems,
    installed: cached.installed,
    marketBaseUrl: cached.marketBaseUrl,
    hasCache: true,
  };
}

/**
 * @param {{ onBack: () => void, onOpenWeb?: (url: string, title?: string) => void }} props
 */
export function MarketPanel({ onBack, onOpenWeb }) {
  const boot = useMemo(() => readInitialMarketState(), []);
  const [marketItems, setMarketItems] = useState(boot.marketItems);
  const [installed, setInstalled] = useState(boot.installed);
  /** 仅无缓存时整页转圈；有缓存时后台静默刷新 */
  const [loading, setLoading] = useState(!boot.hasCache);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [listTab, setListTab] = useState(
    /** @type {"all" | "installed" | "mine"} */ ("all"),
  );
  const [marketBaseUrl, setMarketBaseUrl] = useState(boot.marketBaseUrl);
  const [submitMsg, setSubmitMsg] = useState("");
  /** @type {[Array<object>, Function]} */
  const [customApps, setCustomApps] = useState([]);
  const [showCreateWeb, setShowCreateWeb] = useState(false);
  const [webName, setWebName] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [webDesc, setWebDesc] = useState("");
  const [webShare, setWebShare] = useState(/** @type {"local" | "market"} */ ("local"));

  const hasDataRef = useRef(
    boot.marketItems.length > 0 || boot.installed.length > 0,
  );

  const refresh = useCallback(async () => {
    const hasRows = hasDataRef.current;
    if (hasRows) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const [market, plugins, config, customs] = await Promise.all([
        listMarket(),
        listPlugins(),
        getConfig(),
        listCustomApps(),
      ]);
      const nextMarket = Array.isArray(market) ? market : [];
      const nextInstalled = Array.isArray(plugins) ? plugins : [];
      const nextCustoms = Array.isArray(customs) ? customs : [];
      const nextBase = String(config?.marketBaseUrl || "").trim();
      setMarketItems(nextMarket);
      setInstalled(nextInstalled);
      setCustomApps(nextCustoms);
      setMarketBaseUrl(nextBase);
      hasDataRef.current =
        nextMarket.length > 0 || nextInstalled.length > 0 || nextCustoms.length > 0;
      setMarketCache({
        marketItems: nextMarket,
        installed: nextInstalled,
        marketBaseUrl: nextBase,
      });
    } catch (err) {
      setError(String(err?.message || err));
      if (!hasRows) {
        setMarketItems([]);
        setInstalled([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 打开系统对话框时暂时关闭失焦隐藏，避免选文件时窗口被关掉 */
  function withFileDialog(run) {
    return runWithBlurHideSuspended(run);
  }

  const filteredMarket = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) {
      return marketItems;
    }
    return marketItems.filter((item) => {
      const hay = `${item.name} ${item.description} ${item.category} ${item.author}`
        .toLowerCase();
      return hay.includes(q);
    });
  }, [marketItems, keyword]);

  const filteredInstalled = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) {
      return installed;
    }
    return installed.filter((p) => {
      const id = p.manifest?.id || p.id || "";
      const name = p.manifest?.name || id;
      const desc = p.manifest?.description || "";
      return `${name} ${desc} ${id}`.toLowerCase().includes(q);
    });
  }, [installed, keyword]);

  const filteredMine = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) {
      return customApps;
    }
    return customApps.filter((a) => {
      const hay = `${a.name || ""} ${a.path || ""} ${a.description || ""} ${a.kind || ""}`
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customApps, keyword]);

  function marketStatusLabel(app) {
    const status = String(app?.marketStatus || "local");
    switch (status) {
      case "pending":
        return "待同步云端";
      case "queued":
        return "已投稿审核";
      case "published":
        return "已上架";
      case "unavailable":
        return "云端接口未开通";
      case "error":
        return "同步失败";
      default:
        return app?.shareToMarket ? "仅本机（曾勾选同步）" : "仅本机自用";
    }
  }

  async function handleCreateWebApp() {
    setError("");
    setSubmitMsg("");
    const name = webName.trim();
    const url = webUrl.trim();
    if (!name || !url) {
      setError("请填写名称和网页地址");
      return;
    }
    setBusyId("__web__");
    try {
      const result = await upsertWebApp({
        name,
        url,
        description: webDesc.trim(),
        shareToMarket: webShare === "market",
      });
      setSubmitMsg(result?.syncMessage || "已保存");
      setWebName("");
      setWebUrl("");
      setWebDesc("");
      setWebShare("local");
      setShowCreateWeb(false);
      await refresh();
      setListTab("mine");
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId("");
    }
  }

  async function handleSyncMine(id) {
    setBusyId(id);
    setError("");
    setSubmitMsg("");
    try {
      const result = await syncCustomAppToMarket(id);
      setSubmitMsg(result?.message || "已处理");
      await refresh();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId("");
    }
  }

  async function handleRemoveMine(id) {
    setBusyId(id);
    setError("");
    try {
      await removeCustomApp(id);
      await refresh();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId("");
    }
  }

  async function handleOpenMine(path, title) {
    try {
      if (isWebUrl(path) && typeof onOpenWeb === "function") {
        onOpenWeb(path, title);
        return;
      }
      await openPath(path);
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function handleInstall(id) {
    setBusyId(id);
    setError("");
    try {
      await installMarketItem(id);
      await refresh();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId("");
    }
  }

  async function handleUninstall(id) {
    setBusyId(id);
    setError("");
    try {
      await uninstallPlugin(id);
      await refresh();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId("");
    }
  }

  async function handleInstallLocal() {
    setError("");
    try {
      const selected = await withFileDialog(() =>
        open({
          multiple: false,
          directory: true,
          title: "选择插件目录（含 plugin.json）",
        }),
      );
      if (!selected) {
        return;
      }
      setBusyId("__local__");
      await installPluginFromPath(selected);
      await refresh();
      setListTab("installed");
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId("");
    }
  }

  async function handleInstallZip() {
    setError("");
    try {
      const selected = await withFileDialog(() =>
        open({
          multiple: false,
          filters: [{ name: "Plugin Zip", extensions: ["zip"] }],
          title: "选择插件 zip 包",
        }),
      );
      if (!selected) {
        return;
      }
      setBusyId("__zip__");
      await installPluginFromPath(selected);
      await refresh();
      setListTab("installed");
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId("");
    }
  }

  async function handleSubmitCloud() {
    setError("");
    setSubmitMsg("");
    if (!marketBaseUrl) {
      setError("未配置云端市场。请到「设置」填写云端市场地址，或编辑 ~/.quickbar/config.json 的 marketBaseUrl");
      return;
    }
    try {
      const selected = await withFileDialog(() =>
        open({
          multiple: false,
          filters: [{ name: "Plugin Zip", extensions: ["zip"] }],
          title: "选择要投稿上架的插件 zip",
        }),
      );
      if (!selected) {
        return;
      }
      setBusyId("__submit__");
      const result = await submitMarketPlugin(selected);
      const sid = result?.submissionId || "";
      setSubmitMsg(
        sid
          ? `已投稿，等待审核（单号 ${sid}）`
          : String(result?.message || "已投稿，等待审核"),
      );
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="mk-shell">
      <header
        className="mk-topbar is-drag-region"
        onMouseDown={handleWindowDragMouseDown}
      >
        <button
          type="button"
          className="btn ghost"
          data-no-drag
          onClick={onBack}
        >
          ← 返回
        </button>
        <h1 className="mk-title">应用市场</h1>
        <input
          className="mk-search"
          data-no-drag
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={
            listTab === "all"
              ? `搜索 ${marketItems.length} 款插件…`
              : listTab === "installed"
                ? `搜索已安装 ${installed.length} 款…`
                : `搜索我的 ${customApps.length} 款…`
          }
          spellCheck={false}
        />
        <button
          type="button"
          className="btn"
          data-no-drag
          disabled={loading || refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </header>

      <div
        className="mk-toolbar"
        data-no-drag
      >
        <div className="mk-chips">
          <button
            type="button"
            className={["mk-chip", listTab === "all" ? "is-active" : ""].join(
              " ",
            )}
            onClick={() => setListTab("all")}
          >
            全部
            <span className="mk-chip-count">{marketItems.length}</span>
          </button>
          <button
            type="button"
            className={[
              "mk-chip",
              listTab === "installed" ? "is-active" : "",
            ].join(" ")}
            onClick={() => setListTab("installed")}
          >
            已安装
            <span className="mk-chip-count">{installed.length}</span>
          </button>
          <button
            type="button"
            className={["mk-chip", listTab === "mine" ? "is-active" : ""].join(
              " ",
            )}
            onClick={() => setListTab("mine")}
          >
            我的
            <span className="mk-chip-count">{customApps.length}</span>
          </button>
        </div>
        <div className="mk-toolbar-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setShowCreateWeb((v) => !v);
              setListTab("mine");
              setError("");
              setSubmitMsg("");
            }}
          >
            {showCreateWeb ? "收起创建" : "创建网页应用"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busyId === "__local__"}
            onClick={() => void handleInstallLocal()}
          >
            选目录
          </button>
          <button
            type="button"
            className="btn"
            disabled={busyId === "__zip__"}
            onClick={() => void handleInstallZip()}
          >
            选 Zip
          </button>
          <button
            type="button"
            className="btn"
            disabled={busyId === "__submit__"}
            title={
              marketBaseUrl
                ? "上传插件 zip 到云端市场审核队列"
                : "请先在设置中配置云端市场地址"
            }
            onClick={() => void handleSubmitCloud()}
          >
            {busyId === "__submit__" ? "投稿中…" : "投稿插件"}
          </button>
        </div>
      </div>

      {showCreateWeb ? (
        <div className="mk-create-web" data-no-drag>
          <div className="mk-create-title">快捷创建网页应用</div>
          <p className="mk-create-hint">
            保存后可从首页 / 搜索直接打开网页。可选仅自用，或同步到应用市场（未开通云端时会先记在本地）。
          </p>
          <div className="mk-create-grid">
            <label className="mk-field">
              名称
              <input
                className="mk-input"
                value={webName}
                onChange={(e) => setWebName(e.target.value)}
                placeholder="如 V2EX"
                spellCheck={false}
              />
            </label>
            <label className="mk-field">
              网址
              <input
                className="mk-input"
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
                placeholder="https://www.v2ex.com/"
                spellCheck={false}
              />
            </label>
            <label className="mk-field mk-field-span">
              简介（可选）
              <input
                className="mk-input"
                value={webDesc}
                onChange={(e) => setWebDesc(e.target.value)}
                placeholder="一句话说明"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="mk-create-scope">
            <label className="mk-radio">
              <input
                type="radio"
                name="web-share"
                checked={webShare === "local"}
                onChange={() => setWebShare("local")}
              />
              仅本机自用
            </label>
            <label className="mk-radio">
              <input
                type="radio"
                name="web-share"
                checked={webShare === "market"}
                onChange={() => setWebShare("market")}
              />
              同步到应用市场
              {!marketBaseUrl ? (
                <span className="mk-radio-note">（云端未配置时先标记待同步）</span>
              ) : null}
            </label>
          </div>
          <div className="mk-create-actions">
            <button
              type="button"
              className="btn primary"
              disabled={busyId === "__web__"}
              onClick={() => void handleCreateWebApp()}
            >
              {busyId === "__web__" ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setShowCreateWeb(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="mk-error">{error}</div> : null}
      {submitMsg ? <div className="mk-submit-ok">{submitMsg}</div> : null}

      <main className="mk-main">
        {listTab === "all" ? (
          loading && filteredMarket.length === 0 ? (
            <div className="mk-empty">加载中…</div>
          ) : filteredMarket.length === 0 ? (
            <div className="mk-empty">暂无匹配插件</div>
          ) : (
            <ul className="mk-list">
              {filteredMarket.map((item) => (
                <li
                  key={item.id}
                  className="mk-row"
                >
                  <PluginAvatar name={item.name} />
                  <div className="mk-row-body">
                    <div className="mk-row-title">{item.name}</div>
                    <div className="mk-row-desc">
                      {item.description || "暂无简介"}
                    </div>
                    <div className="mk-row-meta">
                      {item.category || "其它"}
                      {" · v"}
                      {item.version}
                      {item.author ? ` · ${item.author}` : ""}
                    </div>
                  </div>
                  {item.installed ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === item.id}
                      onClick={() => void handleUninstall(item.id)}
                    >
                      {busyId === item.id ? "…" : "卸载"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busyId === item.id}
                      onClick={() => void handleInstall(item.id)}
                    >
                      {busyId === item.id ? "安装中…" : "安装"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : listTab === "installed" ? (
          loading && filteredInstalled.length === 0 ? (
            <div className="mk-empty">加载中…</div>
          ) : filteredInstalled.length === 0 ? (
            <div className="mk-empty">暂无已安装插件</div>
          ) : (
            <ul className="mk-list">
              {filteredInstalled.map((p) => {
                const id = p.manifest?.id || p.id;
                const name = p.manifest?.name || id;
                const desc = p.manifest?.description || "";
                const version = p.manifest?.version || "";
                return (
                  <li
                    key={id}
                    className="mk-row"
                  >
                    <PluginAvatar name={name} />
                    <div className="mk-row-body">
                      <div className="mk-row-title">
                        {name}
                        {p.builtin ? (
                          <span className="mk-badge">内建</span>
                        ) : null}
                      </div>
                      <div className="mk-row-desc">
                        {desc || "已安装插件"}
                      </div>
                      <div className="mk-row-meta">
                        {id}
                        {version ? ` · v${version}` : ""}
                      </div>
                    </div>
                    {p.builtin ? (
                      <span className="mk-row-hint">内建</span>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === id}
                        onClick={() => void handleUninstall(id)}
                      >
                        {busyId === id ? "…" : "卸载"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : filteredMine.length === 0 ? (
          <div className="mk-empty">
            还没有自建应用。点上方「创建网页应用」，或从搜索粘贴 exe 加入本地启动。
          </div>
        ) : (
          <ul className="mk-list">
            {filteredMine.map((app) => {
              const kind = app.kind || (String(app.path || "").startsWith("http") ? "web" : "native");
              const isWeb = kind === "web";
              return (
                <li
                  key={app.id}
                  className="mk-row"
                >
                  <PluginAvatar name={app.name} />
                  <div className="mk-row-body">
                    <div className="mk-row-title">
                      {app.name}
                      <span className="mk-badge">{isWeb ? "网页" : "本地"}</span>
                    </div>
                    <div className="mk-row-desc">
                      {app.description || app.path}
                    </div>
                    <div className="mk-row-meta">
                      {marketStatusLabel(app)}
                      {app.marketMessage ? ` · ${app.marketMessage}` : ""}
                    </div>
                  </div>
                  <div className="mk-row-actions">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => void handleOpenMine(app.path, app.name)}
                    >
                      打开
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === app.id}
                      title={
                        marketBaseUrl
                          ? "推送到云端应用市场"
                          : "未配置云端时会标记为待同步"
                      }
                      onClick={() => void handleSyncMine(app.id)}
                    >
                      {busyId === app.id ? "…" : "同步市场"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === app.id}
                      onClick={() => void handleRemoveMine(app.id)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <footer className="mk-foot">
        <span className="mk-foot-advantage">
          免费应用可添加，数量无限制
        </span>
        <span className="mk-foot-meta">
          {marketBaseUrl
            ? `云端 · ${marketBaseUrl}`
            : "本地市场 · 可在设置配置云端地址"}
        </span>
      </footer>
    </div>
  );
}
