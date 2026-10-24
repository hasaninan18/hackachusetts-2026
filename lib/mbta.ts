// MBTA V3 nearby-stops client + pure parse/rank for TrialPath MA
// (spec: getting-there). Mirrors lib/clinicaltrials.ts: PURE parsing/ranking here,
// all network I/O driven from the route handler (structure.md: pure logic in lib/,
// I/O in routes). Distances are MILES (lib/ is canonical miles); the one unit
// boundary is miles -> degrees for the MBTA filter[radius].
//
// Live-probe findings (api-v3.mbta.com/stops, 2026-10-24, see design.md):
//   - The /stops endpoint exposes NO `route` relationship; `include=route` adds
//     nothing (no `included` block). So line names/colors are NOT available from
//     /stops — we set `lines: []` and NEVER fabricate labels. routeType comes from
//     each stop's `vehicle_type` attribute (0 light rail, 1 subway, 2 commuter
//     rail, 3 bus).
//   - Rail platforms share a `parent_station` (e.g. the two Charles/MGH platforms
//     both -> place-chmnl, same name), so we de-dup by name and prefer the parent
//     station id for Stop.id.
//   - wheelchair_boarding is an integer: 1 accessible, 2 not accessible, 0/missing
//     unknown.
import { cachedFetchJson } from "./cache";
import { haversineMi } from "./geo";
import type { RouteType, Stop } from "./types";

/** MBTA V3 stops endpoint. */
const MBTA_STOPS_BASE = "https://api-v3.mbta.com/stops";
/** Default walk budget in miles for the nearby-stops search (~0.01deg radius). */
const DEFAULT_RADIUS_MI = 0.7;
/** Explicit page[limit] so the payload is bounded (the live API caps/paginates). */
const DEFAULT_PAGE_LIMIT = 50;
/** How long to wait on MBTA before giving up and returning []. Bounded (Req 7.2). */
const MBTA_TIMEOUT_MS = 4_000;
/** Most stops returned to the caller (Requirement 3.2). */
const MAX_STOPS = 3;
/** ~0.01 degrees of radius covers ~0.7 mi (structure.md units note). */
const DEGREES_PER_MILE = 0.01 / 0.7;
/** Floor on the degree radius so a tiny/zero mile budget still queries something. */
const MIN_RADIUS_DEG = 0.001;

// ---------------------------------------------------------------------------
// Raw MBTA V3 shapes — only the fields we consume. Everything optional: the API
// omits/null-fills fields and the parsers below default/guard defensively.
// ---------------------------------------------------------------------------
export interface MbtaStopAttributes {
  name?: string;
  latitude?: number;
  longitude?: number;
  /** 0 light rail, 1 heavy rail/subway, 2 commuter rail, 3 bus (-> RouteType). */
  vehicle_type?: number;
  /** 1 accessible, 2 not accessible, 0/missing unknown. */
  wheelchair_boarding?: number;
}
export interface MbtaStopRelationships {
  parent_station?: { data?: { id?: string } | null } | null;
}
export interface MbtaStop {
  id?: string;
  attributes?: MbtaStopAttributes;
  relationships?: MbtaStopRelationships;
}
export interface MbtaStopsResponse {
  data?: MbtaStop[];
}

// ---------------------------------------------------------------------------
// Pure helpers — no I/O, total (never throw on bad input).
// ---------------------------------------------------------------------------

/**
 * Convert a miles radius to MBTA degrees for `filter[radius]` (~0.01deg ~= 0.7 mi).
 * The ONLY unit boundary. Monotonic and non-negative; a non-finite or negative
 * budget falls back to {@link MIN_RADIUS_DEG}. Total.
 */
export function milesToMbtaDegrees(mi: number): number {
  if (!Number.isFinite(mi) || mi <= 0) return MIN_RADIUS_DEG;
  return Math.max(MIN_RADIUS_DEG, mi * DEGREES_PER_MILE);
}

/**
 * Build the MBTA V3 `/stops` URL (Requirement 2.1) with the probe-verified params:
 * latitude/longitude, a degree radius, `filter[location_type]=0,1`,
 * `filter[route_type]=0,1,2,3`, an explicit `page[limit]`, and `sort=distance`.
 */
export function buildStopsUrl({
  lat,
  lon,
  radiusMi = DEFAULT_RADIUS_MI,
  limit = DEFAULT_PAGE_LIMIT,
}: {
  lat: number;
  lon: number;
  radiusMi?: number;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set("filter[latitude]", String(lat));
  params.set("filter[longitude]", String(lon));
  params.set("filter[radius]", String(milesToMbtaDegrees(radiusMi)));
  // location_type 0 = stop/platform, 1 = station. Excludes entrances/generic nodes.
  params.set("filter[location_type]", "0,1");
  // route_type 0 light rail, 1 subway, 2 commuter rail, 3 bus.
  params.set("filter[route_type]", "0,1,2,3");
  params.set("page[limit]", String(limit));
  params.set("sort", "distance");
  return `${MBTA_STOPS_BASE}?${params.toString()}`;
}

/**
 * Map `wheelchair_boarding` to the domain tri-state (Requirement 4):
 * `1` -> `true` (accessible), `2` -> `false` (not accessible), `0`/missing/junk ->
 * `null` (unknown). NEVER returns `true` for an unknown value. Total.
 */
export function parseWheelchair(raw: number | undefined): boolean | null {
  if (raw === 1) return true;
  if (raw === 2) return false;
  return null;
}

/** Coerce a raw `vehicle_type` to a {@link RouteType} (0..3), else `null`. Total. */
export function toRouteType(vehicleType: number | undefined): RouteType | null {
  if (vehicleType === 0 || vehicleType === 1 || vehicleType === 2 || vehicleType === 3) {
    return vehicleType;
  }
  return null;
}

/**
 * Build one domain {@link Stop} from a raw MBTA stop, measured from `origin`
 * (the corrected site coordinates). Returns `null` for entries we cannot trust:
 * missing/blank name, non-finite coordinates, or an unusable vehicle type —
 * those are skipped so malformed data never throws or pollutes the list
 * (Requirement 6.3). `id` prefers the parent-station id (Requirement 5.2);
 * `lines: []` because `/stops` exposes no route relationship (Requirement 2.3).
 */
export function stopFromRaw(
  raw: MbtaStop,
  origin: { lat: number; lon: number },
): Stop | null {
  const attrs = raw.attributes;
  if (!attrs) return null;
  const name = typeof attrs.name === "string" ? attrs.name.trim() : "";
  if (name === "") return null;
  const { latitude, longitude } = attrs;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const routeType = toRouteType(attrs.vehicle_type);
  if (routeType === null) return null;
  const parentId = raw.relationships?.parent_station?.data?.id;
  const id =
    typeof parentId === "string" && parentId !== ""
      ? parentId
      : typeof raw.id === "string" && raw.id !== ""
        ? raw.id
        : name; // last-resort stable key
  return {
    id,
    name,
    routeType,
    lines: [], // /stops has no route relationship (live-probe verified)
    wheelchair: parseWheelchair(attrs.wheelchair_boarding),
    walkMi: haversineMi(origin.lat, origin.lon, latitude as number, longitude as number),
  };
}

/**
 * Parse + rank raw MBTA stops into up to {@link MAX_STOPS} domain {@link Stop}s
 * (Requirement 3). Pure and total:
 *  1. map each raw stop via {@link stopFromRaw}, dropping unusable entries;
 *  2. de-dup by `name`, keeping the NEAREST instance (rail platforms repeat);
 *  3. sort ascending by `walkMi`;
 *  4. take the first three.
 */
export function rankStops(
  rawStops: MbtaStop[] | undefined,
  origin: { lat: number; lon: number },
): Stop[] {
  if (!Array.isArray(rawStops)) return [];
  const byName = new Map<string, Stop>();
  for (const raw of rawStops) {
    const stop = stopFromRaw(raw, origin);
    if (stop === null) continue;
    const existing = byName.get(stop.name);
    if (existing === undefined || stop.walkMi < existing.walkMi) {
      byName.set(stop.name, stop);
    }
  }
  return [...byName.values()].sort((a, b) => a.walkMi - b.walkMi).slice(0, MAX_STOPS);
}

// ---------------------------------------------------------------------------
// I/O layer — the ONLY place that touches the network. Driven by the route.
// ---------------------------------------------------------------------------

/**
 * Fetch the MBTA stops URL with a bounded {@link MBTA_TIMEOUT_MS} timeout and
 * parse its JSON body. Throws on abort/non-OK/network error; wrapped by
 * {@link fetchNearbyStops} so callers never see the throw. Passed to
 * {@link cachedFetchJson} as the fetcher (Requirement 7.3).
 */
async function fetchStopsJson(url: string): Promise<MbtaStopsResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MBTA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/vnd.api+json" },
    });
    if (!res.ok) throw new Error(`MBTA responded ${res.status}`);
    return (await res.json()) as MbtaStopsResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Return up to three nearest MBTA stops for the corrected site `origin`
 * (Requirements 1, 3, 5). This is the I/O entry point the route calls.
 *
 * It NEVER rejects: on timeout, network error, non-OK status, or a malformed
 * payload it resolves to `[]` so an MBTA problem can never break the trial
 * detail (Requirement 6). Successful responses are cached by URL via
 * {@link cachedFetchJson} (Requirement 7.3).
 */
export async function fetchNearbyStops(
  origin: { lat: number; lon: number },
  opts: { radiusMi?: number; limit?: number } = {},
): Promise<Stop[]> {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) return [];
  const url = buildStopsUrl({ lat: origin.lat, lon: origin.lon, ...opts });
  try {
    const body = await cachedFetchJson(url, () => fetchStopsJson(url));
    return rankStops(body.data, origin);
  } catch {
    // Any MBTA failure/timeout/malformed body: degrade to no stops, never throw.
    return [];
  }
}
