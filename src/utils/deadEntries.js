/**
 * 已下线的演示/占位项：不在首页、最近使用中展示
 */

/** @type {ReadonlySet<string>} */
export const DEAD_PLUGIN_IDS = new Set(["hello-tool", "apps", "commands"]);

/** @type {ReadonlySet<string>} */
export const DEAD_COMMAND_IDS = new Set(["hello"]);

/** @type {ReadonlySet<string>} */
const DEAD_TITLES = new Set([
  "Hello Tool",
  "Hello Quickbar",
  "系统应用",
  "自定义命令",
]);

/**
 * @param {{ id?: string, title?: string, payload?: string, action?: string, kind?: string }} tile
 */
export function isDeadLaunchTile(tile) {
  if (!tile) {
    return true;
  }
  const id = String(tile.id || "");
  const payload = String(tile.payload || "");
  const title = String(tile.title || "").trim();

  if (DEAD_TITLES.has(title)) {
    return true;
  }
  if (DEAD_PLUGIN_IDS.has(payload)) {
    return true;
  }
  const commandId = id.replace(/^cmd:|^pin:cmd:/, "");
  if (DEAD_COMMAND_IDS.has(payload) || DEAD_COMMAND_IDS.has(commandId)) {
    return true;
  }
  if (id.startsWith("plugin:") && DEAD_PLUGIN_IDS.has(id.slice("plugin:".length))) {
    return true;
  }
  return false;
}

/**
 * @param {{ manifest?: { id?: string } } | string} pluginOrId
 */
export function isDeadPlugin(pluginOrId) {
  const id =
    typeof pluginOrId === "string"
      ? pluginOrId
      : String(pluginOrId?.manifest?.id || "");
  return DEAD_PLUGIN_IDS.has(id);
}
