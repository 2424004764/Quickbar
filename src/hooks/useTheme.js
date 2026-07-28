/**
 * 主题偏好：读配置、写配置、监听系统深浅色变化
 */
import { useCallback, useEffect, useState } from "react";
import { getConfig, setTheme as setThemeApi } from "../pluginApi/api";
import {
  applyThemeToDocument,
  normalizeTheme,
  resolveAppearance,
} from "../utils/theme";

/**
 * @returns {{
 *   theme: import("../utils/theme").ThemePref,
 *   appearance: import("../utils/theme").Appearance,
 *   setTheme: (next: string) => Promise<void>,
 * }}
 */
export function useTheme() {
  const [theme, setThemeState] = useState(
    () =>
      normalizeTheme(
        typeof document !== "undefined"
          ? document.documentElement.getAttribute("data-theme-pref")
          : "system",
      ),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await getConfig();
        if (cancelled) {
          return;
        }
        const next = normalizeTheme(config?.theme);
        setThemeState(next);
        applyThemeToDocument(next);
      } catch (err) {
        console.error("load theme failed", err);
        if (!cancelled) {
          applyThemeToDocument("system");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 随系统时监听 OS 深浅色切换
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyThemeToDocument("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback(async (next) => {
    const pref = normalizeTheme(next);
    applyThemeToDocument(pref);
    setThemeState(pref);
    try {
      const config = await setThemeApi(pref);
      const saved = normalizeTheme(config?.theme);
      setThemeState(saved);
      applyThemeToDocument(saved);
    } catch (err) {
      console.error("save theme failed", err);
      throw err;
    }
  }, []);

  return {
    theme,
    appearance: resolveAppearance(theme),
    setTheme,
  };
}
