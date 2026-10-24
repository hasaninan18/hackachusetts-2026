// 10-minute in-memory cache for upstream ClinicalTrials.gov responses.
//
// Lives in the I/O layer: route handlers fetch upstream through this helper so a
// fresh entry is served without a network round-trip. Pure parse functions never
// import it. The clock is injected (`now`) so every behavior is deterministically
// testable — no `Date.now()` is read inside the hot path except as the default arg.

export const CACHE_TTL_MS = 600_000; // 10 minutes

interface CacheEntry<T> {
  value: T;
  storedAt: number; // ms epoch, from the injected clock
}

// Module-scope store, keyed by upstream URL (search) or NCT ID (detail).
const store = new Map<string, CacheEntry<unknown>>();

/**
 * Return the cached value for `key` when it is still fresh (< CACHE_TTL_MS old
 * relative to `now`); otherwise `undefined`. A stale entry is left in place so
 * `cachedFetchJson` can still fall back to it when the fetcher throws.
 */
export function getCached<T>(key: string, now: number): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (entry === undefined) return undefined;
  if (now - entry.storedAt < CACHE_TTL_MS) return entry.value;
  return undefined;
}

/** Store `value` under `key`, stamped with the injected clock `now`. */
export function setCached<T>(key: string, value: T, now: number): void {
  store.set(key, { value, storedAt: now });
}

/**
 * Serve a fresh (< 10 min) entry for `key` without calling `fetcher`.
 * On a miss or stale entry, call `fetcher`, cache the result and return it.
 * If `fetcher` throws and ANY entry exists for `key` (fresh or stale), return
 * that entry as a fallback; otherwise rethrow.
 */
export async function cachedFetchJson<T>(
  key: string,
  fetcher: () => Promise<T>,
  now: number = Date.now(),
): Promise<T> {
  const fresh = getCached<T>(key, now);
  if (fresh !== undefined) return fresh;

  try {
    const value = await fetcher();
    setCached(key, value, now);
    return value;
  } catch (err) {
    const stale = store.get(key) as CacheEntry<T> | undefined;
    if (stale !== undefined) return stale.value;
    throw err;
  }
}
