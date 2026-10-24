import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CACHE_TTL_MS, cachedFetchJson, getCached, setCached } from "./cache";

// Each test uses a distinct key so the module-scope Map never leaks state
// between cases. `k()` mints a unique key per call.
let counter = 0;
const k = (label: string) => `${label}:${counter++}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cachedFetchJson", () => {
  it("serves a fresh hit without calling the fetcher", async () => {
    const key = k("fresh");
    const t0 = 1_000_000;
    setCached(key, { n: 1 }, t0);

    const fetcher = vi.fn(async () => ({ n: 999 }));
    const out = await cachedFetchJson(key, fetcher, t0 + CACHE_TTL_MS - 1);

    expect(out).toEqual({ n: 1 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("calls the fetcher on a miss and caches the result", async () => {
    const key = k("miss");
    const t0 = 2_000_000;
    const fetcher = vi.fn(async () => ({ n: 42 }));

    const out = await cachedFetchJson(key, fetcher, t0);
    expect(out).toEqual({ n: 42 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Immediately readable as a fresh hit — fetcher not called again.
    expect(getCached(key, t0)).toEqual({ n: 42 });
    const out2 = await cachedFetchJson(key, fetcher, t0 + 1);
    expect(out2).toEqual({ n: 42 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("expires at exactly 10 minutes", async () => {
    const key = k("ttl");
    const t0 = 3_000_000;
    setCached(key, { v: "old" }, t0);

    // One ms before the TTL: still fresh.
    expect(getCached(key, t0 + CACHE_TTL_MS - 1)).toEqual({ v: "old" });
    // Exactly at the TTL: expired (now - storedAt === TTL is NOT < TTL).
    expect(getCached(key, t0 + CACHE_TTL_MS)).toBeUndefined();

    // At the boundary the fetcher is called and refreshes the entry.
    const fetcher = vi.fn(async () => ({ v: "new" }));
    const out = await cachedFetchJson(key, fetcher, t0 + CACHE_TTL_MS);
    expect(out).toEqual({ v: "new" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves a still-fresh entry without ever reaching the failing fetcher", async () => {
    // A fresh entry short-circuits at the top of cachedFetchJson, so a failing
    // fetcher is never invoked and the cached value is returned — the user never
    // sees the upstream error while data is still inside the 10-minute window.
    const key = k("fallback-fresh");
    const t0 = 4_000_000;
    setCached(key, { v: "cached" }, t0);

    const boom = vi.fn(async () => {
      throw new Error("upstream 502");
    });
    const out = await cachedFetchJson(key, boom, t0 + CACHE_TTL_MS - 1);

    expect(out).toEqual({ v: "cached" });
    expect(boom).not.toHaveBeenCalled();
  });

  it("does NOT serve an expired entry on fetcher error — rethrows (issue #4 / 10-min policy)", async () => {
    // Regression: a stale (>= TTL) entry must never be returned on upstream failure.
    // The freshness policy wins, so the error propagates instead of leaking old data.
    const key = k("fallback-stale");
    const t0 = 4_500_000;
    setCached(key, { v: "stale" }, t0);

    const boom = vi.fn(async () => {
      throw new Error("upstream 502");
    });

    await expect(cachedFetchJson(key, boom, t0 + CACHE_TTL_MS)).rejects.toThrow("upstream 502");
    expect(boom).toHaveBeenCalledTimes(1);
    // And the expired entry is dropped, so a later read is a clean miss.
    expect(getCached(key, t0 + CACHE_TTL_MS)).toBeUndefined();
  });

  it("just-expired entry (TTL + 1) is not served on error", async () => {
    const key = k("fallback-stale-plus1");
    const t0 = 4_800_000;
    setCached(key, { v: "stale" }, t0);

    const boom = vi.fn(async () => {
      throw new Error("upstream 503");
    });

    await expect(cachedFetchJson(key, boom, t0 + CACHE_TTL_MS + 1)).rejects.toThrow("upstream 503");
  });

  it("rethrows when the fetcher errors and nothing is cached", async () => {
    const key = k("fallback-empty");
    const boom = vi.fn(async () => {
      throw new Error("upstream 504");
    });

    await expect(cachedFetchJson(key, boom, 5_000_000)).rejects.toThrow("upstream 504");
    expect(boom).toHaveBeenCalledTimes(1);
  });

  // Property: on a fetcher error, the fallback honors the freshness window exactly.
  // age < TTL → the cached value is returned; age >= TTL → the error is rethrown.
  it("fallback-on-error respects the TTL boundary for any age", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.integer({ min: -8_640_000_000, max: 8_640_000_000 }),
        fc.integer({ min: 0, max: 4 * CACHE_TTL_MS }),
        fc.jsonValue(),
        async (label, t0, age, value) => {
          const key = `prop-fallback:${label}:${counter++}`;
          setCached(key, value, t0);
          const boom = async () => {
            throw new Error("boom");
          };
          const call = cachedFetchJson(key, boom, t0 + age);
          if (age < CACHE_TTL_MS) {
            expect(await call).toStrictEqual(value);
          } else {
            await expect(call).rejects.toThrow("boom");
          }
        },
      ),
    );
  });
});

describe("getCached / setCached", () => {
  it("returns undefined for an unknown key", () => {
    expect(getCached(k("unknown"), 0)).toBeUndefined();
  });

  // Property: for any key and any elapsed time strictly under the TTL, a value
  // that was just stored is returned unchanged.
  it("returns the stored value unchanged for any age < TTL", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 0, max: CACHE_TTL_MS - 1 }),
        fc.integer({ min: -8_640_000_000, max: 8_640_000_000 }),
        fc.jsonValue(),
        (label, elapsed, t0, value) => {
          const key = `prop:${label}:${counter++}`;
          setCached(key, value, t0);
          expect(getCached(key, t0 + elapsed)).toStrictEqual(value);
        },
      ),
    );
  });
});
