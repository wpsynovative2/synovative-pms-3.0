/**
 * Light / dark theme. The choice lives in localStorage; with no saved choice
 * the operating system's preference decides. It is applied as `data-theme` on
 * <html>, which globals.css keys every colour token off.
 *
 * Kept free of "use client" so the root layout (a Server Component) can inline
 * THEME_INIT_SCRIPT as a real string.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "synovative-pms:theme";

/**
 * Runs synchronously in <head> before the first paint, so a saved light theme
 * never flashes dark first (see Next's "preventing flash before hydration").
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
