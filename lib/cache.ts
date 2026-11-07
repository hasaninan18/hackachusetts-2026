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

// In-flight fetches for callers that opt in with `shareInFlight`, keyed like the store.
// Opt-in only: two callers that share a key but not a deadline or error type (the detail
// route waits 10 s, simplify waits 1.5 s, both keyed by NCT ID) must not join each other's
// fetch, or one would inherit the other's timeout and error class. Cached RESULTS are still
// shared by everyone.
const inflight = new Map<string, Promise<unknown>>();

/**
 * Call `fetcher`, cache the result and return it. If `fetcher` throws (synchronously or
 * not), fall back to the cached entry ONLY when it is still fresh (< CACHE_TTL_MS old
 * relative to `now`); an expired entry is never served, so the error propagates rather than
 * returning data older than the 10-minute policy.
 */
async function fetchAndCache<T>(key: string, fetcher: () => Promise<T>, now: number): Promise<T> {
  try {
    const value = await fetcher();
    setCached(key, value, now);
    return value;
  } catch (err) {
    const fallback = getCached<T>(key, now);
    if (fallback !== undefined) return fallback;
    store.delete(key);
    throw err;
  }
}

/**
 * Serve a fresh (< 10 min) entry for `key` without calling `fetcher`.
 * On a miss or stale entry, call `fetcher`, cache the result and return it.
 * If `fetcher` throws, fall back to the cached entry ONLY when it is still fresh
 * (< CACHE_TTL_MS old relative to `now`); an expired entry is never served, so the
 * error propagates rather than returning data older than the 10-minute policy.
 *
 * With `shareInFlight`, concurrent misses for the same `key` (that also pass
 * `shareInFlight`) wait on the first caller's fetch instead of starting their own, and get
 * the same value or the same error. Only use it where every such caller has the same
 * deadline and error handling (the live search, keyed by its upstream URL).
 */
export async function cachedFetchJson<T>(
  key: string,
  fetcher: () => Promise<T>,
  now: number = Date.now(),
  { shareInFlight = false }: { shareInFlight?: boolean } = {},
): Promise<T> {
  const fresh = getCached<T>(key, now);
  if (fresh !== undefined) return fresh;
  if (!shareInFlight) return fetchAndCache(key, fetcher, now);

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending !== undefined) return pending;

  // Register BEFORE the fetcher runs: `Promise.resolve().then` defers it, so even a fetcher
  // that throws synchronously settles `run` after it is in the map, and the cleanup below
  // removes it. Only remove the entry if it is still this run (never a newer one).
  const run = Promise.resolve().then(() => fetchAndCache(key, fetcher, now));
  inflight.set(key, run);
  const cleanup = () => {
    if (inflight.get(key) === run) inflight.delete(key);
  };
  run.then(cleanup, cleanup);
  return run;
}
