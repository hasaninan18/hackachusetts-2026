// National ZIP → rough location lookup (docs/NATIONAL_PLAN.md §3, §7).
//
// The table lives in public/zcta/<3-digit prefix>.json (built by scripts/build-zcta.mjs from
// the Census 2024 Gazetteer). The browser fetches only the prefix shard it needs, so the full
// ZIP never leaves the device; the search itself only sends coordinates rounded to 0.01°.

import { type Region, regionHasStateCode } from "./region";

export type ZipLookup =
  | { kind: "ok"; lat: number; lon: number; state: string }
  /** Not five digits. */
  | { kind: "invalid" }
  /** A real ZIP area outside the region this build serves. */
  | { kind: "outside"; state: string }
  /** Five digits, but not a residential ZIP area we know (e.g. PO-box-only ZIPs). */
  | { kind: "unknown" }
  /** The shard could not be loaded (offline, server error). */
  | { kind: "error" };

type Shard = Record<string, [number, number, string]>;
type ShardFetcher = (prefix: string) => Promise<Shard | null>;

export function isZipFormat(zip: string): boolean {
  return /^\d{5}$/.test(zip);
}

/** Pure: resolve a ZIP against its loaded shard (`null` = no shard for that prefix). */
export function resolveZip(zip: string, shard: Shard | null, region: Region): ZipLookup {
  if (!isZipFormat(zip)) return { kind: "invalid" };
  const entry = shard && Object.hasOwn(shard, zip) ? shard[zip] : undefined;
  if (!entry) return { kind: "unknown" };
  const [lat, lon, state] = entry;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { kind: "unknown" };
  if (!regionHasStateCode(region, state)) return { kind: "outside", state };
  return { kind: "ok", lat, lon, state };
}

/** Fetch one shard from public/zcta/. A 404 means no ZIP area has that prefix. */
async function fetchShard(prefix: string): Promise<Shard | null> {
  const res = await fetch(`/zcta/${prefix}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`zcta shard ${prefix}: ${res.status}`);
  return (await res.json()) as Shard;
}

const shardCache = new Map<string, Promise<Shard | null>>();

/**
 * Look up a typed ZIP for `region`. Shards are cached per page load; a failed fetch is not
 * cached, so the next submit retries. Never rejects.
 */
export async function lookupZip(
  zip: string,
  region: Region,
  fetcher: ShardFetcher = fetchShard,
): Promise<ZipLookup> {
  if (!isZipFormat(zip)) return { kind: "invalid" };
  const prefix = zip.slice(0, 3);
  let pending = shardCache.get(prefix);
  if (!pending) {
    pending = fetcher(prefix);
    shardCache.set(prefix, pending);
  }
  try {
    return resolveZip(zip, await pending, region);
  } catch {
    shardCache.delete(prefix);
    return { kind: "error" };
  }
}

/** Test hook: forget cached shards. */
export function clearZipCache(): void {
  shardCache.clear();
}
