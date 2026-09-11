"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { IconMoon, IconSun } from "./icons";
import { cx } from "./primitives";

/*
 * The source of truth is the `data-theme` attribute the <head> script already
 * set, so every toggle on screen reads it through one observer instead of
 * holding its own copy in state.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

const getTheme = (): Theme =>
  document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";

// Matches the attribute the root layout renders on the server.
const getServerTheme = (): Theme => "dark";

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode — the choice still applies for this visit */
  }
}

/** Round sun / moon switch, styled after the one on synovative.vercel.app. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 shadow-card",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-pop",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright",
        className,
      )}
    >
      {theme === "dark" ? (
        <IconSun size={17} className="text-st-submitted" />
      ) : (
        <IconMoon size={17} className="text-brand-ink" />
      )}
    </button>
  );
}
