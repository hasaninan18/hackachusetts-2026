import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeCache } from "@vercel/functions";

const vercel = vi.hoisted(() => ({ getCache: vi.fn() }));
vi.mock("@vercel/functions", () => ({ getCache: vercel.getCache }));

import { SHARED_CACHE_TTL_SECONDS, createSharedCache } from "./shared-cache";

function fakeRuntime(): RuntimeCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    set: vi.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    expireTag: vi.fn(async () => {}),
  };
}

const ENV_KEYS = ["VERCEL", "RUNTIME_CACHE_ENDPOINT", "RUNTIME_CACHE_HEADERS"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
beforeEach(() => {
  vercel.getCache.mockReset();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("in-memory fallback (local dev, tests)", () => {
  it("is used off Vercel, without touching getCache", async () => {
    const cache = createSharedCache();
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    expect(vercel.getCache).not.toHaveBeenCalled();
  });

  it("expires entries after 24 hours", async () => {
    let now = 1_000_000;
    const cache = createSharedCache({ runtime: null, now: () => now });
    await cache.set("k", "v");
    now += SHARED_CACHE_TTL_SECONDS * 1000 - 1;
    expect(await cache.get("k")).toBe("v");
    now += 1;
    expect(await cache.get("k")).toBeUndefined();
    expect(SHARED_CACHE_TTL_SECONDS).toBe(86_400);
  });

  it("returns copies, so callers cannot mutate a cached entry", async () => {
    const cache = createSharedCache({ runtime: null });
    const value = { list: [1] };
    await cache.set("k", value);
    value.list.push(2);
    const read = await cache.get<{ list: number[] }>("k");
    read!.list.push(3);
    expect(await cache.get("k")).toEqual({ list: [1] });
  });
});

describe("Vercel Runtime Cache", () => {
  it("on Vercel, wraps getCache and writes with a 24-hour TTL", async () => {
    process.env.VERCEL = "1";
    const runtime = fakeRuntime();
    vercel.getCache.mockReturnValue(runtime);
    const cache = createSharedCache();
    await cache.set("k", { a: 1 });
    expect(vercel.getCache).toHaveBeenCalledTimes(1);
    expect(runtime.set).toHaveBeenCalledWith("k", { a: 1 }, { ttl: 86_400 });
  });

  it("reads entries another instance wrote", async () => {
    const runtime = fakeRuntime();
    runtime.store.set("k", { from: "other instance" });
    const cache = createSharedCache({ runtime });
    expect(await cache.get("k")).toEqual({ from: "other instance" });
  });

  it("falls back to memory when the runtime cache errors", async () => {
    const runtime = fakeRuntime();
    runtime.get = vi.fn(async () => {
      throw new Error("runtime cache down");
    });
    runtime.set = vi.fn(async () => {
      throw new Error("runtime cache down");
    });
    const cache = createSharedCache({ runtime });
    await expect(cache.set("k", 1)).resolves.toBeUndefined();
    expect(await cache.get("k")).toBe(1);
    cache.clearMemory();
    expect(await cache.get("k")).toBeUndefined();
  });

  it("asks getCache for sha256 keys instead of the default 32-bit hash", async () => {
    process.env.VERCEL = "1";
    vercel.getCache.mockReturnValue(fakeRuntime());
    await createSharedCache().get("k");
    const opts = vercel.getCache.mock.calls[0][0] as { namespace: string; keyHashFunction: (k: string) => string };
    expect(opts.namespace).toBe("trialpath");
    expect(opts.keyHashFunction("simplify:v2:NCT07043426:es:abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(opts.keyHashFunction("a")).not.toBe(opts.keyHashFunction("b"));
  });

  it("falls back to memory when getCache throws", async () => {
    process.env.VERCEL = "1";
    vercel.getCache.mockImplementation(() => {
      throw new Error("no cache in context");
    });
    const cache = createSharedCache();
    await cache.set("k", 2);
    expect(await cache.get("k")).toBe(2);
  });
});
