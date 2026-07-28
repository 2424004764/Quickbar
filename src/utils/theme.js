/**
 * 界面主题：dark / light / system（随系统深浅色）
 */

/** @typedef {"dark" | "light" | "system"} ThemePref */
/** @typedef {"dark" | "light"} Appearance */

export const THEME_OPTIONS = [
  { value: "system", label: "随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

/**
 * @param {unknown} theme
 * @returns {ThemePref}
 */
export function normalizeTheme(theme) {
  const value = String(theme || "")
    .trim()
    .toLowerCase();
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

/** @returns {Appearance} */
export function systemAppearance() {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
}

/**
 * @param {unknown} themePref
 * @returns {Appearance}
 */
export function resolveAppearance(themePref) {
  const pref = normalizeTheme(themePref);
  if (pref === "light" || pref === "dark") {
    return pref;
  }
  return systemAppearance();
}

/**
 * 写入 html[data-theme]，驱动 CSS 变量
 * @param {unknown} themePref
 * @returns {Appearance}
 */
export function applyThemeToDocument(themePref) {
  const pref = normalizeTheme(themePref);
  const appearance = resolveAppearance(pref);
  const root = document.documentElement;
  root.setAttribute("data-theme", appearance);
  root.setAttribute("data-theme-pref", pref);
  return appearance;
}
