"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { applyTheme, readThemePref } from "@/lib/theme";

/** The theme actually showing, read from <html data-theme>, which the inline
 * script, this button and the Settings page all set. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-theme-pref"],
  });
  return () => observer.disconnect();
}

const shown = () =>
  document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";

/** Switches between the low-light theme and the light one. "Match system"
 * is offered on the Settings page. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, shown, () => "dark");

  // With "Match system" chosen, follow the system as it changes.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => {
      if (readThemePref() === "system") applyTheme("system");
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="btn icon"
      aria-label={
        dark ? "Switch to the light theme" : "Switch to the low-light theme"
      }
      title={dark ? "Light theme" : "Low-light theme"}
      onClick={() => applyTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
