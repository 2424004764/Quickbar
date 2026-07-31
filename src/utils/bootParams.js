/**
 * 从 URL 解析启动参数（独立插件窗用）
 */

/**
 * @param {string} [search] 如 "?view=plugin&id=x"；默认读 window.location.search
 * @returns {{
 *   view: string,
 *   pluginId: string,
 *   pluginTitle: string,
 *   browserUrl: string,
 *   browserTitle: string,
 *   detached: boolean,
 * }}
 */
export function readBootParams(search) {
  const raw =
    typeof search === "string"
      ? search
      : typeof window !== "undefined"
        ? window.location.search
        : "";
  const params = new URLSearchParams(
    raw.startsWith("?") ? raw.slice(1) : raw,
  );
  return {
    view: params.get("view") || "search",
    pluginId: params.get("id") || "",
    pluginTitle: decodeURIComponent(params.get("title") || ""),
    browserUrl: params.get("url") || "",
    browserTitle: decodeURIComponent(params.get("title") || ""),
    detached: params.get("detached") === "1",
  };
}
