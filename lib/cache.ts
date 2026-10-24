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
 * relative to `now`); otherwise `undefined`. Expired entries are never returned —
 * the 10-minute freshness window is enforced here and on the failure fallback path
 * in `cachedFetchJson`.
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
 * If `fetcher` throws, fall back to the cached entry ONLY when it is still fresh
 * (< CACHE_TTL_MS old relative to `now`); an expired entry is never served, so the
 * error propagates rather than returning data older than the 10-minute policy.
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
    // Freshness is enforced even on failure: only serve a fallback that is still
    // within the 10-minute window. An expired entry is dropped and the error wins,
    // so callers never receive data older than CACHE_TTL_MS.
    const fallback = getCached<T>(key, now);
    if (fallback !== undefined) return fallback;
    store.delete(key);
    throw err;
  }
}
