import type { ThemePref } from "./types";

/**
 * Finder opens in its low-light theme. A choice of "light" or "system" is
 * kept per browser and applied by an inline script before the first paint,
 * so the page never flashes the wrong theme.
 */
export const THEME_KEY = "finder.theme.v1";
export const DEFAULT_THEME: ThemePref = "dark";

export function isThemePref(value: unknown): value is ThemePref {
  return value === "dark" || value === "light" || value === "system";
}

export function resolveTheme(
  pref: ThemePref,
  prefersLight: boolean,
): "dark" | "light" {
  if (pref === "system") return prefersLight ? "light" : "dark";
  return pref;
}

/** Runs in <head> before the page paints (see app/layout.tsx). */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(p!=="light"&&p!=="system")p="dark";var t=p==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;document.documentElement.setAttribute("data-theme",t);document.documentElement.setAttribute("data-theme-pref",p)}catch(e){}})()`;

export function readThemePref(): ThemePref {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return isThemePref(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(pref: ThemePref): void {
  const prefersLight = window.matchMedia(
    "(prefers-color-scheme: light)",
  ).matches;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(pref, prefersLight));
  root.setAttribute("data-theme-pref", pref);
  try {
    window.localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
