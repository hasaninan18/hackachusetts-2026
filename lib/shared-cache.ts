// Shared result cache for the simplify pipeline (24-hour TTL).
//
// On Vercel this wraps Vercel Runtime Cache (getCache from @vercel/functions), so every
// function instance in the region sees the same entries: a summary generated for one
// visitor is reused by the next one instead of calling Bedrock again. Off Vercel (local dev,
// tests) the runtime cache is not available, so it falls back to an in-memory Map with the
// same TTL. A small in-memory layer also sits in front of the runtime cache on Vercel, so a
// runtime-cache error or timeout degrades to "this instance only" instead of failing.
//
// Values must be JSON-serializable. Both layers store a JSON copy, so a caller can never
// mutate a cached entry through a returned object. A runtime-cache hit is copied into the
// memory layer with a fresh TTL, so callers that need a hard age limit should store their
// own timestamp in the value (lib/simplify-service.ts does).
import { createHash } from "node:crypto";
import { getCache, type RuntimeCache } from "@vercel/functions";

/** 24 hours, in seconds (the unit Vercel Runtime Cache takes for `ttl`). */
export const SHARED_CACHE_TTL_SECONDS = 24 * 60 * 60;
/** Upper bound on in-memory entries so a long-lived dev server cannot grow without limit. */
const MAX_MEMORY_ENTRIES = 1000;

export interface SharedCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  /** Drop the in-memory layer (tests). The runtime cache is left alone. */
  clearMemory(): void;
}

export interface SharedCacheOptions {
  /**
   * The runtime cache to use, `null` to force the in-memory Map, or a function resolving one
   * lazily. Defaults to Vercel Runtime Cache when running on Vercel, otherwise `null`.
   */
  runtime?: RuntimeCache | null | (() => RuntimeCache | null);
  ttlSeconds?: number;
  /** Injected clock (ms epoch) for the in-memory TTL. */
  now?: () => number;
  /** Backing Map for the in-memory layer (defaults to a new one). */
  memory?: Map<string, MemoryEntry>;
}

export interface MemoryEntry {
  json: string;
  expiresAt: number;
}

// Next bundles route handlers and pages separately, so a plain module-level Map would give
// POST /api/simplify and the trial page two different caches in one `next dev` process.
// Keeping the default Map on globalThis lets them share it (Vercel shares via Runtime Cache).
const GLOBAL_MEMORY = Symbol.for("trialpath.sharedCache.memory");
function processMemory(): Map<string, MemoryEntry> {
  const g = globalThis as typeof globalThis & { [GLOBAL_MEMORY]?: Map<string, MemoryEntry> };
  return (g[GLOBAL_MEMORY] ??= new Map());
}

/** True when this process runs on Vercel, where Runtime Cache is provided per request. */
function onVercel(): boolean {
  return (
    process.env.VERCEL === "1" ||
    (!!process.env.RUNTIME_CACHE_ENDPOINT && !!process.env.RUNTIME_CACHE_HEADERS)
  );
}

/** sha256 instead of the package's default 32-bit key hash, so keys cannot realistically collide. */
export function sha256Key(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function defaultRuntime(): RuntimeCache | null {
  if (!onVercel()) return null;
  try {
    return getCache({ namespace: "trialpath", keyHashFunction: sha256Key });
  } catch {
    return null;
  }
}

export function createSharedCache(options: SharedCacheOptions = {}): SharedCache {
  const ttlSeconds = options.ttlSeconds ?? SHARED_CACHE_TTL_SECONDS;
  const now = options.now ?? Date.now;
  const memory = options.memory ?? new Map<string, MemoryEntry>();
  let resolved = false;
  let runtime: RuntimeCache | null = null;

  const runtimeCache = (): RuntimeCache | null => {
    if (!resolved) {
      const r = options.runtime === undefined ? defaultRuntime : options.runtime;
      runtime = typeof r === "function" ? r() : r;
      resolved = true;
    }
    return runtime;
  };

  const readMemory = <T>(key: string): T | undefined => {
    const entry = memory.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      memory.delete(key);
      return undefined;
    }
    return JSON.parse(entry.json) as T;
  };

  const writeMemory = (key: string, value: unknown) => {
    if (memory.size >= MAX_MEMORY_ENTRIES && !memory.has(key)) {
      // Map keeps insertion order, so the first key is the oldest entry.
      const oldest = memory.keys().next().value;
      if (oldest !== undefined) memory.delete(oldest);
    }
    memory.set(key, { json: JSON.stringify(value), expiresAt: now() + ttlSeconds * 1000 });
  };

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const local = readMemory<T>(key);
      if (local !== undefined) return local;
      const rc = runtimeCache();
      if (!rc) return undefined;
      try {
        const value = await rc.get(key);
        if (value === null || value === undefined) return undefined;
        writeMemory(key, value);
        return value as T;
      } catch {
        return undefined; // runtime cache unavailable: behave like a miss
      }
    },
    async set<T>(key: string, value: T): Promise<void> {
      writeMemory(key, value);
      const rc = runtimeCache();
      if (!rc) return;
      try {
        await rc.set(key, value, { ttl: ttlSeconds });
      } catch {
        // The in-memory copy still serves this instance.
      }
    },
    clearMemory() {
      memory.clear();
    },
  };
}

/** The process-wide shared cache (Vercel Runtime Cache on Vercel, in-memory elsewhere). */
export const sharedCache: SharedCache = createSharedCache({ memory: processMemory() });
