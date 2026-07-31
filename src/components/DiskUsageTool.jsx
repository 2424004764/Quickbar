/**
 * 磁盘 / 文件夹占用分析
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  DISK_USAGE_DONE_EVENT,
  DISK_USAGE_PROGRESS_EVENT,
  diskAnalyze,
  diskCancelAnalyze,
  diskListDrives,
  diskScanState,
} from "../pluginApi/api";
import { runWithBlurHideSuspended } from "../utils/windowDrag";

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) {
    return `${n} B`;
  }
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/**
 * @param {string} path
 * @returns {string | null}
 */
function parentPath(path) {
  const s = String(path || "").replace(/[/\\]+$/, "");
  if (!s) {
    return null;
  }
  if (/^[A-Za-z]:$/i.test(s)) {
    return null;
  }
  if (/^[A-Za-z]:\\?$/i.test(String(path || ""))) {
    return null;
  }
  const idx = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  if (idx <= 0) {
    return null;
  }
  if (/^[A-Za-z]:$/i.test(s.slice(0, idx))) {
    return `${s.slice(0, idx)}\\`;
  }
  return s.slice(0, idx) || null;
}

/**
 * 路径面包屑：点击任意段可跳到该级
 * @param {string} fullPath
 * @returns {Array<{ label: string, path: string }>}
 */
function pathCrumbs(fullPath) {
  const raw = String(fullPath || "").trim();
  if (!raw) {
    return [];
  }
  const sep = raw.includes("\\") ? "\\" : "/";
  /** @type {Array<{ label: string, path: string }>} */
  const crumbs = [];

  if (/^[A-Za-z]:[\\/]?/i.test(raw)) {
    const drive = `${raw[0].toUpperCase()}:\\`;
    crumbs.push({ label: `${raw[0].toUpperCase()}:`, path: drive });
    const rest = raw.replace(/^[A-Za-z]:[\\/]*/i, "");
    if (!rest) {
      return crumbs;
    }
    const parts = rest.split(/[\\/]+/).filter(Boolean);
    let acc = drive.replace(/\\$/, "");
    for (const part of parts) {
      acc = `${acc}\\${part}`;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }

  const parts = raw.split(/[\\/]+/).filter(Boolean);
  let acc = raw.startsWith(sep) ? "" : "";
  for (const part of parts) {
    acc = `${acc}${sep}${part}`;
    crumbs.push({ label: part, path: acc || sep });
  }
  return crumbs;
}

/**
 * 按占用从高到低；未完成的垫底
 * @param {Array<object>} list
 */
function sortBySizeDesc(list) {
  return [...list].sort((a, b) => {
    const ad = a.done === false ? 0 : 1;
    const bd = b.done === false ? 0 : 1;
    if (ad !== bd) {
      return bd - ad;
    }
    const ds = Number(b.size || 0) - Number(a.size || 0);
    if (ds !== 0) {
      return ds;
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

const TREEMAP_MAX_ITEMS = 80;

/**
 * 平衡二分 treemap：面积与 size 成正比，比简单横条更适合宽高有限的窗口。
 * 超过上限的微小条目合并成「其他」，避免创建成百上千个 DOM。
 * @param {Array<object>} source
 */
function buildTreemap(source) {
  const completed = sortBySizeDesc(source).filter(
    (entry) => entry.done !== false && Number(entry.size) > 0,
  );
  if (!completed.length) {
    return [];
  }

  let items = completed.slice(0, TREEMAP_MAX_ITEMS);
  if (completed.length > TREEMAP_MAX_ITEMS) {
    const rest = completed.slice(TREEMAP_MAX_ITEMS);
    items = [
      ...items,
      {
        name: `其他 ${rest.length} 项`,
        path: "",
        isDir: false,
        isOther: true,
        size: rest.reduce((sum, entry) => sum + Number(entry.size || 0), 0),
      },
    ];
  }

  /** @type {Array<object>} */
  const boxes = [];
  function split(group, x, y, width, height) {
    if (!group.length || width <= 0 || height <= 0) {
      return;
    }
    if (group.length === 1) {
      boxes.push({ ...group[0], x, y, width, height });
      return;
    }
    const total = group.reduce((sum, entry) => sum + Number(entry.size), 0);
    let firstTotal = 0;
    let cut = 1;
    for (let i = 0; i < group.length - 1; i += 1) {
      firstTotal += Number(group[i].size);
      cut = i + 1;
      if (firstTotal >= total / 2) {
        break;
      }
    }
    const ratio = total > 0 ? firstTotal / total : 0.5;
    if (width >= height) {
      const firstWidth = width * ratio;
      split(group.slice(0, cut), x, y, firstWidth, height);
      split(group.slice(cut), x + firstWidth, y, width - firstWidth, height);
    } else {
      const firstHeight = height * ratio;
      split(group.slice(0, cut), x, y, width, firstHeight);
      split(group.slice(cut), x, y + firstHeight, width, height - firstHeight);
    }
  }
  split(items, 0, 0, 100, 100);
  return boxes;
}

/** @param {string} value */
function treemapColor(value) {
  let hash = 0;
  for (const char of String(value || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 62% 47%)`;
}

export function DiskUsageTool() {
  /** @type {[{ path: string, label: string }[], Function]} */
  const [drives, setDrives] = useState([]);
  const [path, setPath] = useState("");
  /** @type {[object | null, Function]} */
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** @type {[string[], Function]} */
  const [history, setHistory] = useState([]);
  /** @type {[object | null, Function]} */
  const [progress, setProgress] = useState(null);
  /** 扫描中动态列表（按大小降序） */
  const [liveEntries, setLiveEntries] = useState(/** @type {object[]} */ ([]));
  /** @type {[object | null, Function]} */
  const [volume, setVolume] = useState(null);
  const busyRef = useRef(false);
  const scanRootRef = useRef("");

  useEffect(() => {
    void diskListDrives()
      .then((list) => setDrives(Array.isArray(list) ? list : []))
      .catch(() => setDrives([]));
  }, []);

  /** 应用一次进度快照（自己发起的扫描和接管的扫描共用） */
  const applyProgress = useCallback((payload) => {
    if (!payload) {
      return;
    }
    setProgress(payload);
    if (payload.volume) {
      setVolume(payload.volume);
    }
    if (Array.isArray(payload.entries)) {
      setLiveEntries(sortBySizeDesc(payload.entries));
    }
  }, []);

  const applyResult = useCallback((data) => {
    if (!data) {
      return;
    }
    setResult(data);
    setPath(data.root || "");
    scanRootRef.current = data.root || "";
    if (data.volume) {
      setVolume(data.volume);
    }
    setLiveEntries(sortBySizeDesc(data.entries || []));
  }, []);

  // 挂载时接管已在进行的扫描（分离窗口后新窗口靠这个续上进度）
  useEffect(() => {
    void diskScanState()
      .then((state) => {
        if (state?.running) {
          busyRef.current = true;
          scanRootRef.current = state.root || "";
          setBusy(true);
          setPath(state.root || "");
          applyProgress(state.progress);
          return;
        }
        if (state?.result) {
          applyResult(state.result);
        }
      })
      .catch(() => {});
  }, [applyProgress, applyResult]);

  useEffect(() => {
    let unlistenProgress;
    let unlistenDone;
    void (async () => {
      unlistenProgress = await listen(DISK_USAGE_PROGRESS_EVENT, ({ payload }) => {
        if (!busyRef.current) {
          return;
        }
        // 忽略上一轮扫描的迟到事件
        if (
          scanRootRef.current
          && payload?.root
          && String(payload.root).toLowerCase() !== scanRootRef.current.toLowerCase()
        ) {
          return;
        }
        applyProgress(payload);
      });
      unlistenDone = await listen(DISK_USAGE_DONE_EVENT, ({ payload }) => {
        if (!busyRef.current) {
          return;
        }
        busyRef.current = false;
        setBusy(false);
        setProgress(null);
        applyResult(payload);
      });
    })();
    return () => {
      if (typeof unlistenProgress === "function") {
        unlistenProgress();
      }
      if (typeof unlistenDone === "function") {
        unlistenDone();
      }
    };
  }, [applyProgress, applyResult]);

  const analyze = useCallback(
    async (target, pushHistory = true) => {
      const p = String(target || "").trim();
      if (!p) {
        setError("请先选择磁盘或文件夹");
        return;
      }
      if (busyRef.current) {
        await diskCancelAnalyze();
      }
      busyRef.current = true;
      scanRootRef.current = p;
      setBusy(true);
      setError("");
      setProgress(null);
      setLiveEntries([]);
      setResult(null);
      setVolume(null);
      setPath(p);
      try {
        const data = await diskAnalyze(p);
        applyResult(data);
        if (pushHistory) {
          setHistory((prev) => {
            if (prev[prev.length - 1] === (data.root || p)) {
              return prev;
            }
            return [...prev, data.root || p];
          });
        }
      } catch (err) {
        setError(String(err?.message || err));
        setResult(null);
      } finally {
        busyRef.current = false;
        setBusy(false);
        setProgress(null);
      }
    },
    [applyResult],
  );

  async function pickFolder() {
    try {
      const selected = await runWithBlurHideSuspended(() =>
        open({
          multiple: false,
          directory: true,
          title: "选择要分析的文件夹",
          defaultPath: path.trim() || undefined,
        }),
      );
      if (!selected) {
        return;
      }
      const next = Array.isArray(selected) ? selected[0] : selected;
      if (next) {
        await analyze(String(next));
      }
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  function goUp() {
    const parent = parentPath(path);
    if (parent) {
      void analyze(parent);
    }
  }

  function goBack() {
    if (history.length < 2) {
      return;
    }
    const next = history.slice(0, -1);
    const target = next[next.length - 1];
    setHistory(next);
    void analyze(target, false);
  }

  const entries = useMemo(() => {
    if (busy && liveEntries.length) {
      return liveEntries;
    }
    if (Array.isArray(result?.entries)) {
      return sortBySizeDesc(result.entries);
    }
    return liveEntries;
  }, [busy, liveEntries, result]);

  const liveTotal = useMemo(
    () =>
      entries
        .filter((e) => e.done !== false)
        .reduce((sum, e) => sum + (Number(e.size) || 0), 0),
    [entries],
  );
  const treemap = useMemo(() => buildTreemap(entries), [entries]);
  const crumbs = useMemo(() => pathCrumbs(path), [path]);
  const canGoUp = Boolean(parentPath(path));

  return (
    <div className="du-tool" data-no-drag>
      <p className="pr-codec-hint">
        分析某个磁盘或文件夹的占用情况；扫描中按已统计大小从高到低动态排序。
      </p>

      <div className="du-drives">
        {drives.map((d) => (
          <button
            key={d.path}
            type="button"
            className={[
              "btn",
              "du-drive-btn",
              path.toLowerCase().startsWith(String(d.path).toLowerCase())
                ? "primary"
                : "",
            ].join(" ")}
            disabled={busy}
            title={
              d.total != null
                ? `总量 ${formatBytes(d.total)} · 已用 ${formatBytes(d.used)} · 剩余 ${formatBytes(d.free)}`
                : d.path
            }
            onClick={() => void analyze(d.path)}
          >
            <span>{d.label}</span>
            {d.free != null ? (
              <span className="du-drive-free">剩 {formatBytes(d.free)}</span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void pickFolder()}
        >
          选择文件夹…
        </button>
      </div>

      {volume ? (
        <div className="du-volume">
          <div className="du-volume-head">
            <strong>{volume.path}</strong>
            <span className="du-muted">
              已用 {Number(volume.usedPercent).toFixed(1)}%
            </span>
          </div>
          <div className="du-volume-stats">
            <span>
              总量 <strong>{formatBytes(volume.total)}</strong>
            </span>
            <span>
              已用 <strong>{formatBytes(volume.used)}</strong>
            </span>
            <span>
              剩余 <strong>{formatBytes(volume.free)}</strong>
            </span>
          </div>
          <div className="du-bar-track du-bar-track-wide">
            <div
              className="du-bar-fill du-bar-volume"
              style={{
                width: `${Math.min(100, Math.max(0, volume.usedPercent))}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="pg-row wrap">
        <input
          className="pr-codec-field grow"
          value={path}
          placeholder="路径，例如 D:\ 或 C:\Users"
          disabled={busy}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void analyze(path);
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            className="btn"
            onClick={() => void diskCancelAnalyze()}
          >
            取消
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={!path.trim()}
            onClick={() => void analyze(path)}
          >
            分析
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy || history.length < 2}
          onClick={goBack}
        >
          后退
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !parentPath(path)}
          onClick={goUp}
        >
          上级
        </button>
      </div>

      {error ? <div className="pg-error">{error}</div> : null}

      {busy ? (
        <div className="du-summary">
          <div>
            <strong>{formatBytes(liveTotal)}</strong>
            <span className="du-muted"> 已统计 · 扫描中</span>
            <span className="du-muted">
              {progress?.current ? ` · ${progress.current}` : ""}
            </span>
          </div>
          <div className="du-muted">
            {progress
              ? `${progress.doneEntries}/${progress.totalEntries} 项 · ${
                  progress.scannedFiles
                } 个文件 · ${formatBytes(progress.scannedBytes)} · ${Math.round(
                  progress.elapsedMs / 1000,
                )}s`
              : "正在读取目录…"}
          </div>
          <div className="du-bar-track du-bar-track-wide">
            <div
              className="du-bar-fill"
              style={{
                width: `${
                  progress && progress.totalEntries > 0
                    ? Math.min(
                        100,
                        (progress.doneEntries / progress.totalEntries) * 100,
                      )
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {result && !busy ? (
        <div className="du-summary">
          <div>
            <strong>{formatBytes(result.totalSize)}</strong>
            <span className="du-muted"> 合计</span>
            {result.canceled ? (
              <span className="du-muted">（已取消，结果不完整）</span>
            ) : null}
          </div>
          <div className="du-muted">
            {result.entryCount} 项 · 扫描 {result.scannedFiles} 个文件 ·{" "}
            {result.elapsedMs} ms
          </div>
        </div>
      ) : null}

      {treemap.length > 0 ? (
        <div className="du-heatmap-wrap">
          <div className="du-heatmap-head">
            <div className="du-heatmap-nav">
              <button
                type="button"
                className="btn"
                disabled={busy || !canGoUp}
                title="返回上一级"
                onClick={goUp}
              >
                ← 上级
              </button>
              <nav className="du-crumbs" aria-label="当前路径">
                {crumbs.map((crumb, i) => {
                  const isLast = i === crumbs.length - 1;
                  return (
                    <span key={crumb.path} className="du-crumb">
                      {i > 0 ? <span className="du-crumb-sep">/</span> : null}
                      {isLast ? (
                        <span className="du-crumb-current">{crumb.label}</span>
                      ) : (
                        <button
                          type="button"
                          className="du-crumb-link"
                          disabled={busy}
                          title={crumb.path}
                          onClick={() => void analyze(crumb.path)}
                        >
                          {crumb.label}
                        </button>
                      )}
                    </span>
                  );
                })}
              </nav>
            </div>
            <span className="du-muted">面积越大占用越多 · 点目录进入 · 点上级返回</span>
          </div>
          <div
            className="du-heatmap"
            title={canGoUp ? "右键返回上一级" : undefined}
            onContextMenu={(e) => {
              if (!canGoUp || busy) {
                return;
              }
              e.preventDefault();
              goUp();
            }}
          >
            {treemap.map((box) => {
              const canOpen = box.isDir && !box.isOther && !busy;
              return (
                <button
                  key={box.path || box.name}
                  type="button"
                  className={[
                    "du-heat-cell",
                    canOpen ? "is-clickable" : "",
                  ].join(" ")}
                  style={{
                    left: `${box.x}%`,
                    top: `${box.y}%`,
                    width: `${box.width}%`,
                    height: `${box.height}%`,
                    background: treemapColor(box.path || box.name),
                  }}
                  disabled={!canOpen}
                  title={`${box.name} · ${formatBytes(box.size)}${
                    canOpen ? " · 点击进入" : ""
                  }`}
                  onClick={() => {
                    if (canOpen) {
                      void analyze(box.path);
                    }
                  }}
                >
                  <span className="du-heat-name">{box.name}</span>
                  <span className="du-heat-size">{formatBytes(box.size)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <ul className="du-list">
          {entries.map((e) => {
            const pending = e.done === false;
            return (
              <li
                key={e.path}
                className={["du-item", pending ? "is-pending" : ""].join(" ")}
              >
                <button
                  type="button"
                  className="du-item-main"
                  disabled={busy || pending || !e.isDir}
                  title={e.path}
                  onClick={() => {
                    if (e.isDir && !pending && !busy) {
                      void analyze(e.path);
                    }
                  }}
                >
                  <div className="du-item-top">
                    <span className="du-name">
                      <span className={`du-kind ${e.isDir ? "dir" : "file"}`}>
                        {e.isDir ? "目录" : "文件"}
                      </span>
                      {e.name}
                    </span>
                    <span className="du-size">
                      {pending ? "扫描中…" : formatBytes(e.size)}
                    </span>
                  </div>
                  <div className="du-bar-track">
                    <div
                      className="du-bar-fill"
                      style={{
                        width: pending
                          ? "0%"
                          : `${Math.min(100, Math.max(0, e.percent))}%`,
                      }}
                    />
                  </div>
                  <div className="du-item-meta">
                    {pending
                      ? "等待扫描"
                      : `${Number(e.percent).toFixed(1)}%${
                          e.isDir && !busy ? " · 点击进入" : ""
                        }`}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {result && !busy && entries.length === 0 ? (
        <p className="pr-codec-hint">该目录为空或无法读取子项。</p>
      ) : null}
    </div>
  );
}
