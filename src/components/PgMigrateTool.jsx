/**
 * PostgreSQL schema / 数据迁移（pg_dump + psql）
 * 连接配置保存在本机 ~/.quickbar/pg-migrate.json，不上传。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  PG_MIGRATE_AWAIT_CLEAR_EVENT,
  PG_MIGRATE_AWAIT_EVENT,
  PG_MIGRATE_LOG_EVENT,
  pgDetectTools,
  pgListConnections,
  pgListSchemas,
  pgMigrate,
  pgMigrateReviewReply,
  pgSaveConnections,
  pgTestConnection,
} from "../pluginApi/api";
import {
  isBlurHidePinned,
  runWithBlurHideSuspended,
  setBlurHidePinned,
} from "../utils/windowDrag";

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   host: string,
 *   port: number,
 *   user: string,
 *   password: string,
 *   database: string,
 * }} PgConnection
 */

/**
 * 下拉选项：确保当前值即使不在拉取结果里也能显示
 * @param {string[]} list
 * @param {string} current
 */
function schemaOptions(list, current) {
  const value = String(current || "").trim();
  if (value && !list.includes(value)) {
    return [value, ...list];
  }
  return list;
}

function newId() {
  return `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** @returns {PgConnection} */
function emptyConn() {
  return {
    id: newId(),
    name: "",
    host: "127.0.0.1",
    port: 5432,
    user: "postgres",
    password: "",
    database: "postgres",
  };
}

export function PgMigrateTool() {
  const [tab, setTab] = useState(/** @type {"migrate"|"connections"} */ ("migrate"));
  const [binDir, setBinDir] = useState("");
  /** @type {[PgConnection[], Function]} */
  const [connections, setConnections] = useState([]);
  const [editing, setEditing] = useState(/** @type {PgConnection | null} */ (null));
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [sourceSchema, setSourceSchema] = useState("public");
  const [targetSchema, setTargetSchema] = useState("public");
  /** @type {[string[], Function]} */
  const [sourceSchemas, setSourceSchemas] = useState([]);
  /** @type {[string[], Function]} */
  const [targetSchemas, setTargetSchemas] = useState([]);
  const [mode, setMode] = useState(/** @type {"full"|"schemaOnly"|"dataOnly"} */ ("full"));
  const [clean, setClean] = useState(true);
  const [ensureSchema, setEnsureSchema] = useState(true);
  /** 整体重建目标 schema（DROP … CASCADE），破坏性大，默认关闭 */
  const [recreateSchema, setRecreateSchema] = useState(false);
  const [dumpOnly, setDumpOnly] = useState(false);
  /** 默认开启：每步人工确认，降低误操作 */
  const [review, setReview] = useState(true);
  const [dumpPath, setDumpPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  /** 列表项正在测试的连接 id；编辑表单测试时为空字符串哨兵用 "__edit__" */
  const [testingId, setTestingId] = useState(/** @type {string | null} */ (null));
  const [testMsg, setTestMsg] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [log, setLog] = useState("");
  const [logPath, setLogPath] = useState("");
  /** @type {[null | {
   *   sessionId: string,
   *   step: string,
   *   stepIndex: number,
   *   stepTotal: number,
   *   title: string,
   *   summary: string,
   *   detail: string,
   *   risks: string[],
   *   actionHint: string,
   * }, Function]} */
  const [reviewAwait, setReviewAwait] = useState(null);
  const [reviewReplying, setReviewReplying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pinned, setPinned] = useState(() => isBlurHidePinned());
  const [tools, setTools] = useState(
    /** @type {null | { available: boolean, source: string, binDir: string }} */ (null),
  );
  const [showToolSettings, setShowToolSettings] = useState(false);
  /** 进入工具页后只自动拉取一次 schema */
  const autoFetchedRef = useRef(false);
  const logPreRef = useRef(/** @type {HTMLPreElement | null} */ (null));
  const migrateLogLinesRef = useRef(/** @type {string[]} */ ([]));
  const reviewSessionRef = useRef("");

  useEffect(() => {
    const el = logPreRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [log]);

  const source = useMemo(
    () => connections.find((c) => c.id === sourceId) || null,
    [connections, sourceId],
  );
  const target = useMemo(
    () => connections.find((c) => c.id === targetId) || null,
    [connections, targetId],
  );

  /** 打开系统对话框时暂时关闭失焦隐藏，避免选目录时主窗被藏起来 */
  function withFileDialog(run) {
    return runWithBlurHideSuspended(run);
  }

  const reload = useCallback(async () => {
    const [store, detected] = await Promise.all([
      pgListConnections(),
      pgDetectTools(),
    ]);
    setConnections(Array.isArray(store?.connections) ? store.connections : []);
    setBinDir(String(store?.binDir || ""));
    setTools(detected);
    setShowToolSettings(!detected?.available);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload().catch((err) => {
      setError(String(err?.message || err));
    });
  }, [reload]);

  // 离开工具时不要把「钉住」状态留给整个应用
  useEffect(() => () => void setBlurHidePinned(false), []);

  useEffect(() => {
    if (!sourceId && connections[0]) {
      setSourceId(connections[0].id);
    }
    if (!targetId && connections[1]) {
      setTargetId(connections[1].id);
    } else if (!targetId && connections[0]) {
      setTargetId(connections[0].id);
    }
  }, [connections, sourceId, targetId]);

  /**
   * @param {"source"|"target"} which
   * @param {{ quiet?: boolean, connectionId?: string }} [opts]
   */
  const fetchSchemas = useCallback(
    async (which = "source", opts = {}) => {
      const id = opts.connectionId || (which === "target" ? targetId : sourceId);
      if (!id) {
        if (!opts.quiet) {
          setError(which === "target" ? "请先选择目标数据库" : "请先选择源数据库");
        }
        return;
      }
      if (!opts.quiet) {
        setBusy(true);
        setError("");
      }
      try {
        const list = await pgListSchemas(id);
        if (which === "target") {
          setTargetSchemas(list);
          setTargetSchema((prev) =>
            list.length && !list.includes(prev) ? list[0] : prev,
          );
          if (!opts.quiet) {
            setLog(`目标库已获取 ${list.length} 个 schema`);
          }
        } else {
          setSourceSchemas(list);
          setSourceSchema((prev) =>
            list.length && !list.includes(prev) ? list[0] : prev,
          );
          if (!opts.quiet) {
            setLog(`源库已获取 ${list.length} 个 schema`);
          }
        }
        return list;
      } catch (err) {
        if (!opts.quiet) {
          setError(String(err?.message || err));
        }
        return [];
      } finally {
        if (!opts.quiet) {
          setBusy(false);
        }
      }
    },
    [sourceId, targetId],
  );

  // 连接就绪后自动拉取源/目标 schema 各一次
  useEffect(() => {
    if (!loaded || autoFetchedRef.current) {
      return;
    }
    // 等默认源/目标都选好再拉，避免只拉到一边
    if (!sourceId || !targetId) {
      return;
    }
    autoFetchedRef.current = true;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const [srcList, tgtList] = await Promise.all([
          fetchSchemas("source", { quiet: true, connectionId: sourceId }),
          fetchSchemas("target", { quiet: true, connectionId: targetId }),
        ]);
        if (cancelled) {
          return;
        }
        setLog(
          `已自动拉取 schema：源 ${srcList?.length ?? 0} 个 · 目标 ${tgtList?.length ?? 0} 个`,
        );
      } catch (err) {
        if (!cancelled) {
          setError(String(err?.message || err));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, sourceId, targetId, fetchSchemas]);

  async function persist(nextConnections, nextBinDir = binDir) {
    const store = await pgSaveConnections({
      connections: nextConnections,
      binDir: nextBinDir,
    });
    setConnections(store.connections || []);
    setBinDir(String(store.binDir || ""));
  }

  async function saveEditor() {
    if (!editing) {
      return;
    }
    const name = editing.name.trim() || `${editing.host}/${editing.database}`;
    const next = {
      ...editing,
      name,
      port: Number(editing.port) || 5432,
    };
    const idx = connections.findIndex((c) => c.id === next.id);
    const list =
      idx >= 0
        ? connections.map((c, i) => (i === idx ? next : c))
        : [...connections, next];
    setError("");
    setTestMsg("");
    try {
      await persist(list);
      setEditing(null);
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function testEditor() {
    if (!editing) {
      return;
    }
    setTesting(true);
    setTestingId("__edit__");
    setError("");
    setTestMsg("");
    try {
      const msg = await pgTestConnection({
        ...editing,
        port: Number(editing.port) || 5432,
      });
      setTestMsg(String(msg || "连通成功"));
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setTesting(false);
      setTestingId(null);
    }
  }

  /** 测试已保存列表中的连接 */
  async function testSaved(conn) {
    if (!conn?.id) {
      return;
    }
    setTesting(true);
    setTestingId(conn.id);
    setError("");
    setTestMsg("");
    try {
      const msg = await pgTestConnection({
        ...conn,
        port: Number(conn.port) || 5432,
      });
      setTestMsg(`${conn.name || conn.id}：${String(msg || "连通成功")}`);
    } catch (err) {
      setError(`${conn.name || conn.id}：${String(err?.message || err)}`);
    } finally {
      setTesting(false);
      setTestingId(null);
    }
  }

  async function removeConn(id) {
    if (!window.confirm("确定删除该连接？")) {
      return;
    }
    try {
      await persist(connections.filter((c) => c.id !== id));
      if (sourceId === id) {
        setSourceId("");
      }
      if (targetId === id) {
        setTargetId("");
      }
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function pickDumpPath() {
    try {
      const path = await withFileDialog(() =>
        save({
          defaultPath: `${sourceSchema || "dump"}.sql`,
          filters: [{ name: "SQL", extensions: ["sql"] }],
        }),
      );
      if (path) {
        setDumpPath(path);
      }
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function runMigrate() {
    if (!sourceId || !targetId) {
      setError("请选择源与目标连接");
      return;
    }
    if (!dumpOnly && sourceId === targetId && !window.confirm("源与目标是同一连接，确定继续？")) {
      return;
    }
    const sessionId = `pgrev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    reviewSessionRef.current = sessionId;

    setBusy(true);
    setError("");
    setSuccess("");
    setLogPath("");
    setReviewAwait(null);
    setReviewReplying(false);
    migrateLogLinesRef.current = [];
    setLog(review ? "单步审核已开启，等待第一步确认…" : "开始迁移，等待后端步骤日志…");

    /** @type {Array<() => void>} */
    const unlistens = [];
    try {
      unlistens.push(
        await listen(PG_MIGRATE_LOG_EVENT, ({ payload }) => {
          const step = payload?.step ? String(payload.step) : "";
          const level = payload?.level ? String(payload.level) : "info";
          const message = payload?.message != null ? String(payload.message) : "";
          const elapsed =
            typeof payload?.elapsedMs === "number" ? payload.elapsedMs : "?";
          const line = `[${String(elapsed).padStart(7, " ")}ms] [${level.padEnd(5, " ")}] [${step}] ${message}`;
          migrateLogLinesRef.current = [...migrateLogLinesRef.current, line];
          setLog(migrateLogLinesRef.current.join("\n"));
        }),
      );

      unlistens.push(
        await listen(PG_MIGRATE_AWAIT_EVENT, ({ payload }) => {
          if (!payload || String(payload.sessionId || "") !== sessionId) {
            return;
          }
          setReviewReplying(false);
          setReviewAwait({
            sessionId: String(payload.sessionId || ""),
            step: String(payload.step || ""),
            stepIndex: typeof payload.stepIndex === "number" ? payload.stepIndex : 0,
            stepTotal: typeof payload.stepTotal === "number" ? payload.stepTotal : 0,
            title: String(payload.title || "需要你确认"),
            summary: String(payload.summary || ""),
            detail: String(payload.detail || ""),
            risks: Array.isArray(payload.risks)
              ? payload.risks.map((r) => String(r))
              : [],
            actionHint: String(payload.actionHint || ""),
          });
        }),
      );

      unlistens.push(
        await listen(PG_MIGRATE_AWAIT_CLEAR_EVENT, ({ payload }) => {
          const sid = typeof payload === "string" ? payload : String(payload || "");
          if (sid && sid !== sessionId) {
            return;
          }
          setReviewAwait(null);
          setReviewReplying(false);
        }),
      );

      const result = await pgMigrate({
        sourceId,
        targetId,
        sourceSchema: sourceSchema || "public",
        targetSchema: targetSchema || sourceSchema || "public",
        mode,
        clean,
        ensureSchema,
        recreateSchema: recreateSchema && !dumpOnly,
        dumpPath,
        dumpOnly,
        review,
        sessionId,
      });

      if (result.log) {
        setLog(result.log);
      } else if (migrateLogLinesRef.current.length === 0) {
        const parts = [
          `导出完成: ${result.dumpPath}`,
          result.dump?.stderr?.trim() || result.dump?.stdout?.trim() || "",
        ];
        if (result.ensureSchema) {
          parts.push("--- CREATE SCHEMA ---");
          parts.push(result.ensureSchema.stderr || result.ensureSchema.stdout || "ok");
        }
        if (result.restore) {
          parts.push("--- 导入 ---");
          parts.push(result.restore.stderr || result.restore.stdout || "ok");
        } else if (dumpOnly) {
          parts.push("（仅导出，未导入）");
        }
        setLog(parts.filter(Boolean).join("\n"));
      }
      if (result.logPath) {
        setLogPath(result.logPath);
      }

      const fromSchema = sourceSchema || "public";
      const toSchema = targetSchema || sourceSchema || "public";
      if (dumpOnly) {
        setSuccess(
          `导出成功\nSchema：${fromSchema}\nSQL：${result.dumpPath || "—"}` +
            (result.logPath ? `\n日志：${result.logPath}` : ""),
        );
      } else {
        setSuccess(
          `迁移成功\n${fromSchema} → ${toSchema}\nSQL：${result.dumpPath || "—"}` +
            (result.logPath ? `\n日志：${result.logPath}` : ""),
        );
      }
    } catch (err) {
      setSuccess("");
      setError(String(err?.message || err));
      // 保留已收集的步骤日志，便于排查
      if (migrateLogLinesRef.current.length > 0) {
        setLog(migrateLogLinesRef.current.join("\n"));
      }
    } finally {
      for (const u of unlistens) {
        if (typeof u === "function") {
          u();
        }
      }
      setReviewAwait(null);
      setReviewReplying(false);
      reviewSessionRef.current = "";
      setBusy(false);
    }
  }

  async function replyReview(approved) {
    const sessionId = reviewAwait?.sessionId || reviewSessionRef.current;
    if (!sessionId || reviewReplying) {
      return;
    }
    setReviewReplying(true);
    try {
      await pgMigrateReviewReply(sessionId, approved);
      if (!approved) {
        setReviewAwait(null);
      }
    } catch (err) {
      setError(String(err?.message || err));
      setReviewReplying(false);
    }
  }

  async function saveBinDir() {
    try {
      await persist(connections, binDir);
      setTools(await pgDetectTools());
      setLog("已保存客户端路径设置");
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function pickBinDir() {
    try {
      const selected = await withFileDialog(() =>
        open({
          multiple: false,
          directory: true,
          title: "选择 PostgreSQL 客户端 bin 目录",
          defaultPath: binDir.trim() || undefined,
        }),
      );
      if (!selected) {
        return;
      }
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) {
        setBinDir(String(path));
      }
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  if (!loaded) {
    return <p className="pr-codec-hint">加载连接配置…</p>;
  }

  return (
    <div className="pg-tool">
      <div className="pr-codec-actions">
        <button
          type="button"
          className={["btn", tab === "migrate" ? "primary" : ""].join(" ")}
          onClick={() => setTab("migrate")}
        >
          迁移
        </button>
        <button
          type="button"
          className={["btn", tab === "connections" ? "primary" : ""].join(" ")}
          onClick={() => setTab("connections")}
        >
          数据库连接
        </button>
        <button
          type="button"
          className={["btn", pinned ? "primary" : ""].join(" ")}
          title="钉住后切到别的窗口也不会自动隐藏 Quickbar"
          onClick={() => {
            const next = !pinned;
            setPinned(next);
            void setBlurHidePinned(next);
          }}
        >
          {pinned ? "已钉住" : "钉住窗口"}
        </button>
      </div>
      <p className="pr-codec-hint">
        使用本机 <code>pg_dump</code> / <code>psql</code>。连接（含密码）经
        <strong>本机加密</strong>存于 <code>~/.quickbar/pg-migrate.vault.json</code>
        （Windows 为 DPAPI，仅当前用户在本机、打开 Quickbar 时可解密），请勿拷贝到仓库。
      </p>

      {error ? <div className="pg-error">{error}</div> : null}
      {success ? <div className="pg-success">{success}</div> : null}
      {testMsg ? <div className="pg-test-ok">{testMsg}</div> : null}

      {tab === "connections" ? (
        <div className="pg-section">
          <div className={tools?.available ? "pg-test-ok" : "pg-error"}>
            {tools?.available ? (
              <>
                PostgreSQL 工具已自动识别：{tools.source}
                <br />
                <code>{tools.binDir}</code>
              </>
            ) : (
              <>
                未找到 PostgreSQL 命令行工具。可任选其一：
                <br />
                1）Windows 安装 PostgreSQL 客户端；2）WSL 执行{" "}
                <code>sudo apt install postgresql-client</code>；3）高级设置手动指定
                bin。Navicat 通常不包含 psql / pg_dump。
              </>
            )}
            <div className="pg-row wrap pg-tool-status-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void pgDetectTools().then((status) => {
                    setTools(status);
                    setShowToolSettings(!status?.available);
                  });
                }}
              >
                重新检测
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setShowToolSettings((value) => !value)}
              >
                {showToolSettings ? "收起高级设置" : "高级设置"}
              </button>
            </div>
          </div>

          {showToolSettings ? (
            <label className="pr-codec-label">
              手动指定客户端 bin 目录
              <div className="pg-row">
                <input
                  className="pr-codec-field grow"
                  value={binDir}
                  placeholder="例如 C:\Program Files\PostgreSQL\16\bin"
                  onChange={(e) => setBinDir(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => void pickBinDir()}
                >
                  选择…
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void saveBinDir()}
                >
                  保存
                </button>
              </div>
            </label>
          ) : null}

          <div className="pg-row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setTestMsg("");
                setError("");
                setEditing(emptyConn());
              }}
            >
              新建连接
            </button>
          </div>

          <ul className="pg-conn-list">
            {connections.map((c) => (
              <li
                key={c.id}
                className="pg-conn-item"
              >
                <div className="pg-conn-info">
                  <strong>{c.name}</strong>
                  <div className="pg-conn-meta">
                    {c.user}@{c.host}:{c.port}/{c.database}
                  </div>
                </div>
                <div className="pg-row pg-conn-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={testing}
                    onClick={() => void testSaved(c)}
                  >
                    {testingId === c.id ? "测试中…" : "测试"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={testing}
                    onClick={() => {
                      setTestMsg("");
                      setError("");
                      setEditing({ ...c });
                    }}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={testing}
                    onClick={() => void removeConn(c.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
            {connections.length === 0 ? (
              <li className="pr-codec-hint">暂无连接，先新建一个。</li>
            ) : null}
          </ul>

          {editing ? (
            <div className="pg-editor">
              <h4>编辑连接</h4>
              <div className="pg-grid">
                <label className="pr-codec-label">
                  名称
                  <input
                    className="pr-codec-field"
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                  />
                </label>
                <label className="pr-codec-label">
                  Host
                  <input
                    className="pr-codec-field"
                    value={editing.host}
                    onChange={(e) =>
                      setEditing({ ...editing, host: e.target.value })
                    }
                  />
                </label>
                <label className="pr-codec-label">
                  Port
                  <input
                    className="pr-codec-num"
                    type="number"
                    value={editing.port}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        port: Number(e.target.value) || 5432,
                      })
                    }
                  />
                </label>
                <label className="pr-codec-label">
                  用户
                  <input
                    className="pr-codec-field"
                    value={editing.user}
                    onChange={(e) =>
                      setEditing({ ...editing, user: e.target.value })
                    }
                  />
                </label>
                <label className="pr-codec-label">
                  密码
                  <input
                    className="pr-codec-field"
                    type="password"
                    value={editing.password}
                    onChange={(e) =>
                      setEditing({ ...editing, password: e.target.value })
                    }
                  />
                </label>
                <label className="pr-codec-label">
                  数据库
                  <input
                    className="pr-codec-field"
                    value={editing.database}
                    onChange={(e) =>
                      setEditing({ ...editing, database: e.target.value })
                    }
                  />
                </label>
              </div>
              <div className="pg-row wrap">
                <button
                  type="button"
                  className="btn"
                  disabled={testing || busy}
                  onClick={() => void testEditor()}
                >
                  {testing ? "测试中…" : "测试连通"}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={testing}
                  onClick={() => void saveEditor()}
                >
                  保存连接
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={testing}
                  onClick={() => {
                    setEditing(null);
                    setTestMsg("");
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="pg-section">
          {connections.length < 1 ? (
            <p className="pr-codec-hint">
              请先到「数据库连接」添加至少一个连接。
            </p>
          ) : (
            <>
              <div className="pg-grid">
                <label className="pr-codec-label">
                  源数据库
                  <select
                    className="pr-codec-select"
                    value={sourceId}
                    onChange={(e) => {
                      setSourceId(e.target.value);
                      setSourceSchemas([]);
                    }}
                  >
                    {connections.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                      >
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pr-codec-label">
                  目标数据库
                  <select
                    className="pr-codec-select"
                    value={targetId}
                    onChange={(e) => {
                      setTargetId(e.target.value);
                      setTargetSchemas([]);
                    }}
                    disabled={dumpOnly}
                  >
                    {connections.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                      >
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="pg-grid">
                <label className="pr-codec-label">
                  源 Schema
                  <div className="pg-row">
                    {sourceSchemas.length ? (
                      <select
                        className="pr-codec-select grow"
                        value={sourceSchema}
                        onChange={(e) => setSourceSchema(e.target.value)}
                      >
                        {schemaOptions(sourceSchemas, sourceSchema).map((s) => (
                          <option
                            key={s}
                            value={s}
                          >
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="pr-codec-field grow"
                        value={sourceSchema}
                        onChange={(e) => setSourceSchema(e.target.value)}
                        placeholder="public"
                      />
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !sourceId}
                      title="从源库读取全部 schema"
                      onClick={() => void fetchSchemas("source")}
                    >
                      拉取
                    </button>
                  </div>
                </label>
                <label className="pr-codec-label">
                  目标 Schema
                  <div className="pg-row">
                    {targetSchemas.length ? (
                      <select
                        className="pr-codec-select grow"
                        value={targetSchema}
                        disabled={dumpOnly}
                        onChange={(e) => setTargetSchema(e.target.value)}
                      >
                        {schemaOptions(targetSchemas, targetSchema).map((s) => (
                          <option
                            key={s}
                            value={s}
                          >
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="pr-codec-field grow"
                        value={targetSchema}
                        onChange={(e) => setTargetSchema(e.target.value)}
                        placeholder="与源相同或另填"
                        disabled={dumpOnly}
                      />
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !targetId || dumpOnly}
                      title="从目标库读取全部 schema"
                      onClick={() => void fetchSchemas("target")}
                    >
                      拉取
                    </button>
                  </div>
                </label>
              </div>
              {sourceSchemas.length || targetSchemas.length ? (
                <div className="pg-row wrap">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSourceSchemas([]);
                      setTargetSchemas([]);
                    }}
                  >
                    手动输入 schema
                  </button>
                  <span className="pr-codec-hint">
                    源 {sourceSchemas.length} 个 · 目标 {targetSchemas.length} 个
                  </span>
                </div>
              ) : null}
              <p className="pr-codec-hint">
                两边 schema 名可以不同（如 public → v_factory）；不同时会自动改写导出 SQL。
              </p>

              <div className="pg-row wrap">
                <label className="pr-codec-inline">
                  模式
                  <select
                    className="pr-codec-select"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="full">结构 + 数据</option>
                    <option value="schemaOnly">仅结构</option>
                    <option value="dataOnly">仅数据</option>
                  </select>
                </label>
                <label
                  className="pr-codec-check"
                  title={
                    mode === "dataOnly"
                      ? "仅数据模式下 pg_dump 不允许 --clean"
                      : "导入前先删除目标中已存在的同名对象（表/视图等），避免冲突；不会 CASCADE 删整个 schema"
                  }
                >
                  <input
                    type="checkbox"
                    checked={clean && mode !== "dataOnly"}
                    disabled={mode === "dataOnly"}
                    onChange={(e) => setClean(e.target.checked)}
                  />
                  导入前先清理同名对象（--clean --if-exists）
                </label>
                <label className="pr-codec-check">
                  <input
                    type="checkbox"
                    checked={ensureSchema}
                    disabled={dumpOnly}
                    onChange={(e) => setEnsureSchema(e.target.checked)}
                  />
                  目标库自动 CREATE SCHEMA
                </label>
                <label
                  className="pr-codec-check"
                  title="目标 schema 里已有依赖对象、普通清理删不掉时才用。会先删除目标 schema 及其全部内容，再整体导入"
                >
                  <input
                    type="checkbox"
                    checked={recreateSchema && !dumpOnly}
                    disabled={dumpOnly}
                    onChange={(e) => setRecreateSchema(e.target.checked)}
                  />
                  整体重建目标 schema（先删光再导入）
                </label>
                <label className="pr-codec-check">
                  <input
                    type="checkbox"
                    checked={dumpOnly}
                    onChange={(e) => setDumpOnly(e.target.checked)}
                  />
                  仅导出不导入
                </label>
                <label
                  className="pr-codec-check"
                  title="每一步（导出 / 改写 / 建 schema / 导入）执行前暂停，需人工确认后才继续"
                >
                  <input
                    type="checkbox"
                    checked={review}
                    disabled={busy}
                    onChange={(e) => setReview(e.target.checked)}
                  />
                  单步审核（每步人工确认）
                </label>
              </div>

              {reviewAwait ? (
                <div className="pg-review-card" role="dialog" aria-label="单步审核">
                  <div className="pg-review-badge">
                    需要你确认
                    {reviewAwait.stepIndex > 0 ? (
                      <span>
                        · 第 {reviewAwait.stepIndex}
                        {reviewAwait.stepTotal > 0 ? ` / ${reviewAwait.stepTotal}` : ""} 步
                      </span>
                    ) : null}
                  </div>
                  <div className="pg-review-title">{reviewAwait.title}</div>
                  {reviewAwait.summary ? (
                    <p className="pg-review-summary">{reviewAwait.summary}</p>
                  ) : null}
                  {reviewAwait.risks?.length ? (
                    <div className="pg-review-risk-box">
                      <div className="pg-review-risk-label">请注意</div>
                      <ul className="pg-review-risks">
                        {reviewAwait.risks.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {reviewAwait.detail ? (
                    <details className="pg-review-details" open={reviewAwait.step === "restore"}>
                      <summary>核对信息（连接 / 路径）</summary>
                      <pre className="pg-review-detail">{reviewAwait.detail}</pre>
                    </details>
                  ) : null}
                  {reviewAwait.actionHint ? (
                    <p className="pg-review-hint">{reviewAwait.actionHint}</p>
                  ) : null}
                  <div className="pg-row">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={reviewReplying}
                      onClick={() => void replyReview(true)}
                    >
                      {reviewReplying ? "提交中…" : "确认继续"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={reviewReplying}
                      onClick={() => void replyReview(false)}
                    >
                      取消迁移
                    </button>
                  </div>
                </div>
              ) : null}

              <label className="pr-codec-label">
                导出 SQL 路径（可空，默认 ~/.quickbar/pg-dumps/）
                <div className="pg-row">
                  <input
                    className="pr-codec-field grow"
                    value={dumpPath}
                    onChange={(e) => setDumpPath(e.target.value)}
                    placeholder="自动生成"
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void pickDumpPath()}
                  >
                    选择…
                  </button>
                </div>
              </label>

              <div className="pg-preview">
                <div>
                  源：{source ? `${source.user}@${source.host}:${source.port}/${source.database}` : "—"}
                </div>
                <div>
                  目标：
                  {dumpOnly
                    ? "（仅导出）"
                    : target
                      ? `${target.user}@${target.host}:${target.port}/${target.database}`
                      : "—"}
                </div>
                <div>
                  Schema：{sourceSchema || "public"}
                  {!dumpOnly
                    ? ` → ${targetSchema || sourceSchema || "public"}`
                    : ""}
                </div>
                {recreateSchema && !dumpOnly ? (
                  <div>清理：整体重建目标 schema（会删光后重导）</div>
                ) : null}
                {review ? <div>审核：单步确认已开启</div> : null}
              </div>

              <div className="pg-row">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void runMigrate()}
                >
                  {busy
                    ? reviewAwait
                      ? "等待确认…"
                      : "执行中…"
                    : dumpOnly
                      ? "开始导出"
                      : "开始迁移"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {log ? (
        <div className="pg-log-panel">
          <div className="pg-log-head">
            <span className="pg-log-title">{busy ? "迁移日志（进行中）" : "迁移日志"}</span>
            {logPath ? <span className="pg-log-path" title={logPath}>{logPath}</span> : null}
          </div>
          <pre ref={logPreRef} className={`pg-log${busy ? " is-live" : ""}`}>
            {log}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
