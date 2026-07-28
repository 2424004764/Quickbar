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

/** @returns {Promise<Array<{ id: string, name: string, path: string }>>} */
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
