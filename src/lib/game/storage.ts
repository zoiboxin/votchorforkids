/**
 * 🛡️ safeStorage — localStorage that never crashes.
 *
 * The preview panel embeds the game in a sandboxed / cross-site iframe. In
 * that context many browsers (Safari, hardened Chrome, sandbox without
 * allow-same-origin) THROW a SecurityError on ANY localStorage access instead
 * of serving it. One bare read at module init used to kill the whole bundle —
 * "Application error" right after the splash, while a normal new tab worked
 * fine.
 *
 * Every storage touch in the app now goes through these guards. When storage
 * is blocked, an in-memory Map keeps the session alive (nothing persists
 * across a refresh — the UI says so), and when storage works it mirrors every
 * write so a mid-session flip can never shadow real data.
 */

const mem = new Map<string, string>();
let probed: boolean | null = null;

/** true when this document is not allowed to touch localStorage at all */
export function storageBlocked(): boolean {
  if (probed === null) {
    try {
      const k = "__vc_probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      probed = false;
    } catch {
      probed = true;
    }
  }
  return probed;
}

/** read a key — real storage first, in-memory fallback second, never throws */
export function lsGet(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch { /* blocked — fall through to memory */ }
  return mem.get(key) ?? null;
}

/** write a key — mirrors to memory first, then best-effort real storage */
export function lsSet(key: string, value: string): void {
  mem.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch { /* blocked — the memory copy above keeps this session alive */ }
}

/** remove a key from both layers, never throws */
export function lsRemove(key: string): void {
  mem.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch { /* ignore */ }
}
