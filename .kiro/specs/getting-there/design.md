# Design — getting-there (MBTA transit)

## Overview

`lib/mbta.ts` is the MBTA V3 client plus pure parse/rank helpers, mirroring the
`lib/clinicaltrials.ts` + route split: **pure logic in `lib/`, all network I/O
driven from the route handler** (structure.md). The existing
`app/api/trials/[nct]/route.ts` gains one non-blocking step: after it builds the
`TrialDetail`, it fetches nearby MBTA stops for the chosen site's **corrected**
coordinates and fills `detail.stops`. Any MBTA failure is swallowed so the trial
detail always returns (Requirement 6).

Distances are **miles** everywhere in `lib/` (structure.md). The only unit
boundary is miles→degrees for the MBTA `filter[radius]`.

## Live-probe findings (api-v3.mbta.com/stops, 2026-10-24)

Probed the real API for BMC corrected coords (42.335, -71.0728), radius 0.01°,
`filter[location_type]=0,1`, `filter[route_type]=0,1,2,3`, `page[limit]=50`,
`sort=distance`:

- **No route relationship on stops.** Each stop's `relationships` keys are only
  `facilities`, `parent_station`, `zone`. `?include=route` adds **nothing** —
  the top-level response stays `{data, jsonapi, links}` with no `included` block,
  and no `route` relationship appears. **Conclusion:** line names/colors cannot be
  read from `/stops`. We set `lines: []` and never fabricate labels. Deriving
  real line labels would need a second `/routes?filter[stop]=<id>` call per stop
  (N extra round-trips) — out of scope this round; recorded as a follow-up.
- **`vehicle_type`** gives the route type: `3` (bus) for the BMC street stops,
  `1` (subway) and `0` (light rail) for the MGH platforms. Maps straight to our
  `RouteType` (0 light rail, 1 subway, 2 commuter rail, 3 bus).
- **`parent_station`** is `null` for bus stops but set for rail platforms
  (e.g. Charles/MGH platforms 70073 & 70074 both → `place-chmnl`, both named
  "Charles/MGH"). This is exactly why de-dup by name matters, and why the `id`
  should prefer the parent-station id (`Stop.id` contract comment).
- **`wheelchair_boarding`** observed as integer `1` at every BMC street stop
  (accessible). DEMO_DATA.md records `2` cases elsewhere (Fenwood Road Green E,
  Bowdoin Blue) which we map to `false`.
- **Observed BMC top-3 after name-dedup, nearest first:**
  1. "91 E Concord St" (id 5089, bus, wheelchair_boarding=1) ≈ 0.047 mi
  2. "Albany St opp Boston Medical" (id 10014, bus, wc=1) ≈ 0.063 mi
  3. "Albany St opp E Concord St" (id 10005, bus, wc=1) ≈ 0.078 mi
- `page[limit]=50` returned exactly 50 rows (the cap bit), so an explicit limit
  is required to bound the payload; 41 unique names among those 50.

## Components

### `lib/mbta.ts`

Raw V3 shape (only fields consumed):

```ts
interface MbtaStopAttributes {
  name?: string;
  latitude?: number;
  longitude?: number;
  vehicle_type?: number;        // 0..3 → RouteType
  wheelchair_boarding?: number; // 0 | 1 | 2
}
interface MbtaStop {
  id?: string;
  attributes?: MbtaStopAttributes;
  relationships?: { parent_station?: { data?: { id?: string } | null } };
}
interface MbtaStopsResponse { data?: MbtaStop[] }
```

Pure helpers (no I/O, total):

- `milesToMbtaDegrees(mi: number): number` — `mi * 0.01 / 0.7`, clamped to a
  sane minimum; monotonic and non-negative. The one unit boundary.
- `buildStopsUrl({ lat, lon, radiusMi, limit }): string` — assembles the V3 URL
  with the probe-verified params (`filter[location_type]=0,1`,
  `filter[route_type]=0,1,2,3`, `page[limit]`, `sort=distance`).
- `parseWheelchair(raw): boolean | null` — `1→true`, `2→false`, else `null`
  (Requirement 4). Never presents unknown as accessible.
- `toRouteType(vehicleType): RouteType | null` — accepts 0..3, else `null`.
- `stopFromRaw(raw, origin): Stop | null` — one raw stop → domain `Stop` using
  `haversineMi` for `walkMi`; `id` = parent-station id when present else own id;
  `lines: []`. Returns `null` when name or coords are missing/non-finite or the
  vehicle type is unusable (defensive skip).
- `rankStops(raw[], origin): Stop[]` — map → drop nulls → **de-dup by name,
  keeping the nearest** → sort by `walkMi` asc → take 3 (Requirement 3). Pure.

I/O (driven by the route):

- `fetchNearbyStops(origin, opts?): Promise<Stop[]>` — builds the URL, fetches
  through `cachedFetchJson` (keyed by URL) with a bounded `AbortController`
  timeout, parses with `rankStops`, and on ANY error/timeout/malformed payload
  resolves to `[]` (never rejects) so the route cannot be broken by MBTA
  (Requirements 6, 7).

### `app/api/trials/[nct]/route.ts`

After `const detail = toDetail(studies[0], origin);`, choose the anchor site —
`detail.nearestSite` when it has finite coords, else skip — and call
`fetchNearbyStops`. Assign the result to `detail.stops`. Wrap in try/catch as a
belt-and-suspenders (the fetcher already resolves `[]` on failure). The MBTA call
is awaited but isolated: its failure path returns `[]`, so the 200 detail always
ships. No change to the 404/502/504 ClinicalTrials.gov paths.

## Error handling

| Case | Behavior |
|---|---|
| MBTA timeout (abort) | fetcher resolves `[]`, detail returns 200 with `stops: []` |
| MBTA non-OK / network error | fetcher resolves `[]` |
| Malformed payload (no `data`, bad attrs) | bad entries skipped; `[]` if none usable |
| No stops in radius | `[]` |
| Anchor site has no finite coords | skip MBTA, `stops: []` |

## Testing strategy

All network mocked (`vi.stubGlobal("fetch", ...)`); no live calls in the suite.

- `milesToMbtaDegrees`: monotonic, non-negative.
- `parseWheelchair`: 1→true, 2→false, 0→null, missing→null, junk→null.
- `stopFromRaw`/`rankStops` parsing: maps vehicle_type→routeType, picks
  parent_station id, computes walkMi via `haversineMi`.
- Distance ordering: unsorted raw input returns nearest-first, capped at 3.
- Duplicate-name de-dup: two stops same name → nearest kept, one entry.
- Upstream failure: `fetchNearbyStops` resolves `[]` on reject, non-OK, abort,
  and malformed body.
- Route-level: a detail whose MBTA fetch fails still returns 200 with
  `stops: []`; a successful MBTA mock populates `detail.stops` with corrected-
  coordinate distances.
