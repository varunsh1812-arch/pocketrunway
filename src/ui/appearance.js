// Light, dark, or whatever the device uses. The choice is kept on this device only.
// <html data-mode> carries the mode in use; tokens.css re-derives every colour for "dark".
// BOOT_MODE runs in the page head (scripts/build.mjs) so the first paint is already in the right mode.

export const MODE_KEY = "pocketrunway:mode";

export const MODES = [
  ["system", "Match device"],
  ["light", "Light"],
  ["dark", "Dark"],
];

/** The browser bar's colour: --color-paper in each mode. */
export const BAR = { light: "#f8f4f1", dark: "#15100d" };

export function readMode() {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === "light" || m === "dark" ? m : "system";
  } catch {
    return "system";
  }
}

export function saveMode(mode) {
  try {
    if (mode === "system") localStorage.removeItem(MODE_KEY);
    else localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private mode or blocked storage: the choice lasts for this visit */
  }
}

export function deviceDark() {
  return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
}

export function applyMode(mode) {
  const used = mode === "system" ? (deviceDark()?.matches ? "dark" : "light") : mode;
  document.documentElement.dataset.mode = used;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[used]);
  return used;
}

/** readMode + applyMode for the page head, before React loads. */
export const BOOT_MODE = `(function(){var m;try{m=localStorage.getItem(${JSON.stringify(MODE_KEY)})}catch(e){}var d=m==="dark"||(m!=="light"&&!!window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-mode",d?"dark":"light");var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute("content",d?${JSON.stringify(BAR.dark)}:${JSON.stringify(BAR.light)})})();`;
