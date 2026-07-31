/**
 * Quickbar 与 Rust 宿主的 invoke 封装
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * @typedef {object} SearchItem
 * @property {string} id
 * @property {string} title
 * @property {string} subtitle
 * @property {string} kind
 * @property {string} action
 * @property {string} payload
 * @property {number} score
 * @property {string} [iconDataUrl] 应用图标 data URL
 */

/**
 * @typedef {object} MarketItem
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string} author
 * @property {string} description
 * @property {string} category
 * @property {string} source
 * @property {boolean} installed
 * @property {string | null} [installedVersion]
 */

/** @param {string} query */
export function search(query) {
  return invoke("search", { query });
}

/** @param {string} path */
export function openPath(path) {
  return invoke("open_path", { path });
}

/** 内嵌浏览器排障日志：打到宿主终端，前端 console 在 WebView 里看不到 */
export function browserLog(message) {
  return invoke("browser_log", { message: String(message) }).catch(() => {});
}

// 子 WebView 命令是异步的，若并发下发会出现「先建后关」错序，这里按调用顺序串行。
// 单个命令再加超时兜底：一旦某次调用卡住，后面的关闭指令不能跟着一起卡死。
let browserOpChain = Promise.resolve();
let pendingBounds = null;

/**
 * @param {string} name
 * @param {() => Promise<unknown>} run
 */
function queueBrowserOp(name, run) {
  const next = browserOpChain.then(
    () => withTimeout(name, run),
    () => withTimeout(name, run),
  );
  browserOpChain = next.catch(() => {});
  return next;
}

function withTimeout(name, run) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      void browserLog(`${name} timeout after 5s`);
      resolve(null);
    }, 5000);
    Promise.resolve()
      .then(run)
      .then(
        (v) => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve(v);
          }
        },
        (err) => {
          clearTimeout(timer);
          void browserLog(`${name} failed: ${err}`);
          if (!settled) {
            settled = true;
            resolve(null);
          }
        },
      );
  });
}

/**
 * 主窗内嵌打开网页
 * @param {string} url
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 */
export function browserOpen(url, bounds) {
  void browserLog(`open queued ${url}`);
  return queueBrowserOp("open", () => invoke("browser_open", { url, bounds }));
}

/** @param {{ x: number, y: number, width: number, height: number }} bounds */
export function browserSetBounds(bounds) {
  pendingBounds = bounds;
  return queueBrowserOp("set_bounds", () => {
    const latest = pendingBounds;
    pendingBounds = null;
    return latest ? invoke("browser_set_bounds", { bounds: latest }) : null;
  });
}

export function browserClose() {
  pendingBounds = null;
  void browserLog("close queued");
  return queueBrowserOp("close", () => invoke("browser_close"));
}

/** @param {boolean} visible */
export function browserSetVisible(visible) {
  return queueBrowserOp("set_visible", () =>
    invoke("browser_set_visible", { visible }),
  );
}

export function browserIsOpen() {
  return invoke("browser_is_open");
}

/**
 * 内嵌网页导航
 * @param {"back"|"forward"|"reload"} action
 */
export function browserNav(action) {
  return queueBrowserOp(`nav:${action}`, () =>
    invoke("browser_nav", { action: String(action) }),
  );
}

/** @param {string} value */
export function isWebUrl(value) {
  const s = String(value || "").trim();
  return /^https?:\/\//i.test(s);
}

/**
 * 按本地路径取应用图标 data URL（无则返回 null）
 * @param {string} path
 * @returns {Promise<string | null>}
 */
export function getAppIcon(path) {
  return invoke("get_app_icon", { path });
}

/**
 * 将 exe/lnk 加入本地启动
 * @param {string} path
 * @param {string} [name]
 */
export function addCustomApp(path, name) {
  return invoke("add_custom_app", {
    path,
    name: name || null,
  });
}

/**
 * 创建 / 更新网页应用
 * @param {{
 *   id?: string,
 *   name: string,
 *   url: string,
 *   description?: string,
 *   aliases?: string[],
 *   shareToMarket?: boolean,
 * }} req
 * @returns {Promise<{ app: object, syncMessage: string }>}
 */
export function upsertWebApp(req) {
  return invoke("upsert_web_app", { req });
}

/**
 * 将本机自定义应用同步到云端市场（预留；未配置基址时仅标记 pending）
 * @param {string} id
 * @returns {Promise<{ app: object, synced: boolean, message: string }>}
 */
export function syncCustomAppToMarket(id) {
  return invoke("sync_custom_app_to_market", { id });
}

/** @param {string} id */
export function removeCustomApp(id) {
  return invoke("remove_custom_app", { id });
}

/**
 * 设置云端市场基址（空 = 仅本地）
 * @param {string} url
 */
export function setMarketBaseUrl(url) {
  return invoke("set_market_base_url", { url });
}

/**
 * 读取剪贴板中的可启动路径（资源管理器文件列表或文本）
 * @returns {Promise<string | null>}
 */
export function readClipboardLaunchablePath() {
  return invoke("read_clipboard_launchable_path");
}

/**
 * @returns {Promise<Array<{
 *   id: string,
 *   name: string,
 *   path: string,
 *   kind?: string,
 *   description?: string,
 *   shareToMarket?: boolean,
 *   marketStatus?: string,
 *   marketRemoteId?: string,
 *   marketMessage?: string,
 * }>>}
 */
export function listCustomApps() {
  return invoke("list_custom_apps");
}

/** @param {string} commandId */
export function runUserCommand(commandId) {
  return invoke("run_user_command", { commandId });
}

export function hideMainWindow() {
  return invoke("hide_main_window");
}

export function showMainWindow() {
  return invoke("show_main_window");
}

export function listMarket() {
  return invoke("list_market");
}

/** @param {string} itemId */
export function installMarketItem(itemId) {
  return invoke("install_market_item", { itemId });
}

/**
 * 投稿 zip 到云端市场（待审核）
 * @param {string} path
 * @param {string} [author]
 */
export function submitMarketPlugin(path, author) {
  return invoke("submit_market_plugin", {
    path,
    author: author || null,
  });
}

/** @param {string} path */
export function installPluginFromPath(path) {
  return invoke("install_plugin_from_path", { path });
}

/** @param {string} pluginId */
export function uninstallPlugin(pluginId) {
  return invoke("uninstall_plugin", { pluginId });
}

export function listPlugins() {
  return invoke("list_plugins");
}

export function getConfig() {
  return invoke("get_config");
}

/**
 * 更新界面主题并写入 config.json
 * @param {string} theme dark | light | system
 */
export function setTheme(theme) {
  return invoke("set_theme", { theme });
}

export function refreshAppIndex() {
  return invoke("refresh_app_index");
}

/** @param {boolean} enabled */
export function setBlurHideEnabled(enabled) {
  return invoke("set_blur_hide_enabled", { enabled });
}

/**
 * 更新唤起热键并立即重新注册
 * @param {string} hotkey
 */
export function setHotkey(hotkey) {
  return invoke("set_hotkey", { hotkey });
}

/** 录制热键时暂时注销全局快捷键 */
export function suspendGlobalHotkey() {
  return invoke("suspend_global_hotkey");
}

/** 按配置恢复全局热键 */
export function resumeGlobalHotkey() {
  return invoke("resume_global_hotkey");
}

/** @returns {Promise<{ connections: Array<object>, binDir: string }>} */
export function pgListConnections() {
  return invoke("pg_list_connections");
}

/** @param {{ connections: Array<object>, binDir?: string }} store */
export function pgSaveConnections(store) {
  return invoke("pg_save_connections", { store });
}

/** @returns {Promise<{ available: boolean, source: string, binDir: string, psqlPath: string, pgDumpPath: string }>} */
export function pgDetectTools() {
  return invoke("pg_detect_tools");
}

/**
 * 测试连接是否可达（可用未保存的表单数据）
 * @param {{ id?: string, name?: string, host: string, port: number, user: string, password: string, database: string }} connection
 * @returns {Promise<string>}
 */
export function pgTestConnection(connection) {
  return invoke("pg_test_connection", { connection });
}

/** @param {string} connectionId */
export function pgListSchemas(connectionId) {
  return invoke("pg_list_schemas", { connectionId });
}

/**
 * @param {{
 *   sourceId: string,
 *   targetId: string,
 *   sourceSchema?: string,
 *   targetSchema?: string,
 *   schema?: string,
 *   mode: string,
 *   clean?: boolean,
 *   ensureSchema?: boolean,
 *   recreateSchema?: boolean,
 *   dumpPath?: string,
 *   dumpOnly?: boolean,
 *   review?: boolean,
 *   sessionId?: string,
 * }} req
 */
export function pgMigrate(req) {
  return invoke("pg_migrate", { req });
}

/**
 * 单步审核回复
 * @param {string} sessionId
 * @param {boolean} approved
 */
export function pgMigrateReviewReply(sessionId, approved) {
  return invoke("pg_migrate_review_reply", { sessionId, approved });
}

/** 迁移过程逐步日志事件名 */
export const PG_MIGRATE_LOG_EVENT = "quickbar://pg-migrate-log";
/** 单步审核等待确认 */
export const PG_MIGRATE_AWAIT_EVENT = "quickbar://pg-migrate-await";
/** 单步审核等待结束 */
export const PG_MIGRATE_AWAIT_CLEAR_EVENT = "quickbar://pg-migrate-await-clear";

/** @returns {Promise<Array<{ path: string, label: string, total?: number, free?: number, used?: number }>>} */
export function diskListDrives() {
  return invoke("disk_list_drives");
}

/**
 * @param {string} path
 * @returns {Promise<{
 *   root: string,
 *   totalSize: number,
 *   entryCount: number,
 *   scannedFiles: number,
 *   entries: Array<{ name: string, path: string, isDir: boolean, size: number, percent: number, done?: boolean }>,
 *   elapsedMs: number,
 *   canceled?: boolean,
 *   volume?: { path: string, total: number, free: number, used: number, usedPercent: number },
 * }>}
 */
export function diskAnalyze(path) {
  return invoke("disk_analyze", { path });
}

/** 请求取消正在进行的磁盘扫描 */
export function diskCancelAnalyze() {
  return invoke("disk_cancel_analyze");
}

/**
 * 当前扫描状态（新窗口挂载时用于接管进行中的扫描）
 * @returns {Promise<{ running: boolean, root: string, progress?: object, result?: object }>}
 */
export function diskScanState() {
  return invoke("disk_scan_state");
}

/** 磁盘扫描进度事件名 */
export const DISK_USAGE_PROGRESS_EVENT = "quickbar://disk-usage-progress";
/** 磁盘扫描完成事件名 */
export const DISK_USAGE_DONE_EVENT = "quickbar://disk-usage-done";
