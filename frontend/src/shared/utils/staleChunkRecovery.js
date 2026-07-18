/**
 * Recovery for stale-deployment chunk errors.
 *
 * Every deploy re-hashes the lazy route chunks and deletes the old files.
 * Sessions still running the previous build then fail to dynamically
 * import routes ("Failed to fetch dynamically imported module ..."). A
 * plain reload fixes it because the browser re-fetches the new
 * index.html, so we do that automatically — at most once per window to
 * avoid a reload loop when the failure has a different cause.
 */

const RELOAD_STAMP_KEY = "stale-chunk-reload-at";
const RELOAD_LOOP_WINDOW_MS = 30_000;

export function isStaleChunkError(error) {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  const message = String(error.message || error);
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Unable to preload CSS/i.test(message)
  );
}

/**
 * Reload the page to pick up the freshly deployed build. Returns true when
 * a reload was triggered, false when one already happened recently (caller
 * should fall through to its normal error UI).
 */
export function reloadOnceForStaleChunk() {
  let lastReloadAt = 0;
  try {
    lastReloadAt = Number(sessionStorage.getItem(RELOAD_STAMP_KEY) || 0);
  } catch {
    // Storage unavailable (private mode); reload guard degrades to one try.
  }

  if (Date.now() - lastReloadAt < RELOAD_LOOP_WINDOW_MS) return false;

  try {
    sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
  } catch {
    // Ignore: worst case the guard is skipped once.
  }

  window.location.reload();
  return true;
}
