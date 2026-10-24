# Design — getting-there

## Overview

The getting-there feature turns a trial site's coordinates into a short, readable transit panel:
the nearest MBTA stations with their lines, wheelchair-boarding status, and walking distance in
miles, plus a Google Maps transit directions link — or, when nothing is within range, a plain
"no nearby transit" message and a driving directions link. It has two layers:

- **Presentational UI** (`components/GettingThere.tsx` + `components/LineChip.tsx`): given an
  already-shaped `Stop[]`, the `Site`, and an optional `origin`, it sorts by `walkMi`, shows the
  three nearest, renders each stop's name / lines / access / walk distance, the `go.approx` note
  for non-facility precision, and a single directions link. This layer **exists today**.
- **Data layer** (the `/api/trials/[nct]` route + a new `lib/mbta.ts`): calls MBTA V3 `/stops`,
  filters and de-duplicates the raw stops into `Stop[]`, computes `walkMi` in miles, and returns
  them with the trial. This layer **does not exist in the code visible to this spec** — it is the
  known gap, and its drafts are in "Proposed change for the owner".

`lib/geo.ts` supplies the pure helpers both layers use: `haversineMi` (miles), `formatMiles`, and
`transitDirectionsUrl`.

This design documents the feature as it exists today, maps each requirement to where it is (or is
not yet) satisfied, lists the known gaps, and specifies the data-layer functions as ready-to-lift
drafts in a dedicated section. Those drafts are in **Hasan-owned** files (`lib/mbta.ts`,
`app/api/trials/[nct]/route.ts`) and are **not applied here**.

## Architecture

```
Trial site (lat/lon, from CT.gov, facility-corrected)         Person (browser)
        |                                                        origin? (geolocation)
        v                                                             |
  [GAP] lib/mbta.ts  nearestStops(lat, lon, radiusMi)                 |
        |   MBTA V3 /stops ?filter[latitude]&[longitude]              |
        |     &filter[radius]=<deg>&filter[route_type]=0,1,2,3        |
        |     &include=route  (page[limit] bounded)                   |
        v                                                             |
   raw stops (JSON:API: entrances, nodes, boarding areas,            |
     parent stations — location_type 0..4; 161 KB / ~261 in probe)  |
        |   filter by location_type -> de-dupe by name -> haversineMi |
        v                                                             v
   Stop[]  (id,name,routeType,lines,wheelchair,walkMi) --> /api/trials/[nct] --> lib/data.ts toDetail
        |                                                                            |
        v                                                                            v
  components/GettingThere.tsx  (sort by walkMi, slice 3, render)  <----  TrialDetail.stops
        |                              |
        v                              v
  components/LineChip.tsx      lib/geo.ts transitDirectionsUrl / (GAP) drivingDirectionsUrl
```

Data boundaries (safety.md §3): the only values that leave the device for this feature are the
**site coordinates** (and the person's **origin** coordinates when they shared location) used to
query MBTA and build the directions link. No health answers are sent, stored, or logged.

## Components and contracts

### `components/GettingThere.tsx` (presentational — today)

- Props: `{ site: Site; stops: Stop[]; origin?: {lat,lon}; t: Translate }`.
- Sorts a copy of `stops` by `walkMi` ascending and takes `.slice(0, 3)` — the three nearest.
- Empty list → renders `go.noStops` only. **Today that empty state still renders the single
  transit link below it** (see gap G4 — no driving link yet).
- Each stop row: bold `stop.name`; a wrap of `LineChip`s when `stop.lines.length > 0` (omitted
  otherwise); `go.walk` with `formatMiles(stop.walkMi)`; and an `<Access>` line.
- `<Access wheelchair>`: `true` → `♿` (`aria-hidden`) + `go.accessible` (green `text-fit`);
  `false` → `go.notAccessible` (`text-ask`); `null` → `go.accessUnknown` (`text-muted`). The icon
  is decorative; the meaning is carried by the adjacent visible text (structure.md ♿ rule).
- Shows `go.approx` when `site.locationPrecision !== "facility"`.
- Renders one link: `transitDirectionsUrl(site, origin)`, `target="_blank"`,
  `rel="noopener noreferrer"`, `min-h-12` (≥ 44 px), label `go.directions`.

### `components/LineChip.tsx` (presentational — today)

- Props: `{ line: Line }`. White pill, a colour swatch (`aria-hidden`), then `line.name`.
- Swatch colour is `line.color` only when it matches `/^#[0-9A-Fa-f]{6}$/`; otherwise the neutral
  `#7C878E`. Text is never placed on the line colour (AA contrast for Orange/Silver fails).

### `lib/geo.ts` (pure helpers — today)

- `haversineMi(lat1, lon1, lat2, lon2) → miles`.
- `formatMiles(mi)` → `"< 0.1"` below 0.1 mi, one decimal below 10, rounded whole at ≥ 10.
- `transitDirectionsUrl(dest, origin?)` → `https://www.google.com/maps/dir/?api=1&destination=…&travelmode=transit`
  (adds `origin` only when provided).
- **No `drivingDirectionsUrl` today** (gap G4).

### `lib/types.ts` `Stop` (contract — today)

`{ id, name, routeType: 0|1|2|3, lines: Line[], wheelchair: boolean|null, walkMi }` where
`wheelchair` encodes `wheelchair_boarding` 1 → `true`, 2 → `false`, 0 → `null`. The data layer must
produce exactly this shape; `lib/data.ts` `toDetail` already defends it (drops entries without a
string `name` or finite `walkMi`, defaults `lines` to `[]`).

## Requirements traceability

| Req | Where satisfied | Status |
|-----|-----------------|--------|
| 1 Query MBTA for stops near a site | `lib/mbta.ts` `nearestStops` | **gap G1** (not implemented) |
| 2 Limit page size + show ≤ 3 | `lib/mbta.ts` page limit; `GettingThere` `.slice(0,3)` | slice **done**; page limit **gap G2** |
| 3 Filter by `location_type` | `lib/mbta.ts` filter | **gap G1** |
| 4 De-duplicate by name | `lib/mbta.ts` de-dupe | **gap G1** |
| 5 Render nearest stops | `GettingThere.tsx` + `LineChip.tsx` + `formatMiles` | **done** |
| 6 Transit link + driving when none | `transitDirectionsUrl` (transit) / `drivingDirectionsUrl` (driving) | transit **done**; driving **gap G4** |
| 7 Wheelchair status + unknown | `Stop.wheelchair` mapping + `<Access>` | mapping **gap G1** (in `mbta.ts`); render **done** |
| 8 No-transit / error / loading states | `go.noStops` render; route error handling; loading shell | empty render **partial** (no driving link); error/loading **gap G3** |
| 9 Plain language + privacy | `go.*` copy, copy-guard hook; coords-only off-device | copy **done**; privacy by construction |

## Known gaps

These are behaviors the requirements specify that the code visible to this spec does **not**
implement. They live in files owned by Hasan (`lib/mbta.ts`, `app/api/trials/[nct]/route.ts`) per
structure.md, and are **not** edited by this spec.

- **G1 — No MBTA fetch / shaping layer.** There is no `lib/mbta.ts` and no `/api/trials/[nct]`
  route in view. The whole pipeline — calling `/stops`, miles→degrees at the boundary,
  `route_type` filtering, reading `attributes.latitude/longitude`, `location_type` filtering,
  name de-duplication, line merging, `wheelchair_boarding` → `boolean|null` mapping, and `walkMi`
  via `haversineMi` — is unimplemented. (Requirements 1, 3, 4, and the mapping half of 7.)
- **G2 — No page-size limit.** Nothing bounds the MBTA response today; the live probe returned
  ~161 KB / 261 raw stops for one location. The data layer must cap it (page limit) even though the
  UI already slices to three. (Requirement 2.1.)
- **G3 — No loading / error state for stops specifically.** `GettingThere` renders whatever `stops`
  it is handed; there is no stop-specific `aria-busy` loading shell and no MBTA-failure fallback
  wired in. The route must degrade a failed/timed-out/rate-limited MBTA call to an empty `stops`
  list so the UI shows the no-transit state rather than throwing. (Requirements 8.2, 8.4.)
- **G4 — No driving-directions link.** `lib/geo.ts` exposes only `transitDirectionsUrl`, and
  `GettingThere`'s empty state renders that same transit link. Requirement 6.3 / structure.md want
  a **driving** link when there is no nearby transit. This needs an additive
  `drivingDirectionsUrl` in `lib/geo.ts` (Neil owns `lib/geo.ts`) and a small branch in
  `GettingThere.tsx` (Neil owns `components/**`) to show it in the empty state. (Requirements 6.3,
  8.1.)
- **G5 — i18n copy for the no-transit driving link.** The empty state needs a plain-language label
  for the driving link (e.g. `go.drivingDirections`). `lib/i18n/**` is Neil's. The existing
  `go.noStops` text ("The directions button can still show you a way.") already assumes a usable
  link remains, so the copy change is small. (Requirements 6.3, 9.1.)

## Error, empty, and loading states

- **Stops loading** → the route/page should present an `aria-busy` shell before `stops` arrive
  (gap G3); `GettingThere` itself renders synchronously from props.
- **No stops in range** (`stops` empty) → `go.noStops` message; today the transit link remains
  below it, but Requirement 6.3 wants that to be a **driving** link (gaps G4/G5).
- **MBTA failure / timeout / rate-limit** → the data layer returns an empty `stops` list so the UI
  falls back to the no-transit state instead of throwing (gap G3). `lib/data.ts` `toDetail` already
  tolerates a missing/empty `stops` array.
- **Malformed stop entries** → dropped during shaping (`toDetail` keeps only entries with a string
  `name` and finite `walkMi`) — **done today**.

---

## Proposed change for the owner — NOT applied here

> **Ownership (structure.md):** `lib/mbta.ts` and `app/api/trials/[nct]/route.ts` are **Hasan's**
> (new API clients + `app/api/**`). `lib/geo.ts`, `components/GettingThere.tsx`, and `lib/i18n/**`
> are **Neil's**. Nothing in `lib/`, `app/`, or `components/` is edited by this spec; the code
> below is a ready-to-lift draft for the PRs. Field shapes are taken from the live MBTA probe in
> `KIRO_LOG.md` (2026-10-24): JSON:API, coordinates in `attributes.latitude`/`attributes.longitude`,
> `wheelchair_boarding` values 1 and 2 seen (0 and missing must still be handled), `location_type`
> 0–4 present, the same station name recurring dozens of times, ~161 KB / 261 raw stops.

### Draft 1 — `lib/mbta.ts` (Hasan): fetch, filter, de-duplicate, shape

```ts
// lib/mbta.ts — MBTA V3 /stops client. Pure shaping (shapeStops) is unit-testable; the fetch is
// the only I/O. Canonical distance unit is MILES (structure.md); degrees are used only at the
// MBTA request boundary.
import { haversineMi } from "./geo";
import type { Line, RouteType, Stop } from "./types";

const MBTA_BASE = "https://api-v3.mbta.com";

// structure.md: ~0.7 mi ≈ 0.01°. Convert at the boundary only.
export function milesToMbtaDegrees(mi: number): number {
  return Math.max(0, mi) * (0.01 / 0.7);
}

// JSON:API shapes we actually read (from the probe). Everything optional/loose: treat the response
// as untrusted and never throw on a missing field.
interface RawStop {
  id: string;
  type: "stop";
  attributes?: {
    name?: string;
    latitude?: number;         // probe: coordinates live here, NOT in a nested geoPoint
    longitude?: number;
    location_type?: number;    // 0 platform, 1 station, 2 entrance, 3 node, 4 boarding area
    wheelchair_boarding?: number; // probe saw 1 and 2; 0 and missing must map to null
  };
  relationships?: {
    parent_station?: { data?: { id?: string } | null };
    route?: { data?: { id?: string } | null };
  };
}
interface RawRoute {
  id: string;
  type: "route";
  attributes?: { long_name?: string; short_name?: string; color?: string; type?: number };
}

// wheelchair_boarding: 1 -> true, 2 -> false, 0 or missing/unknown -> null (never guess).
export function wheelchairFrom(v: number | undefined): boolean | null {
  if (v === 1) return true;
  if (v === 2) return false;
  return null; // 0, undefined, or any other value -> unknown
}

// Keep only stop-level entries (platforms + stations), drop entrances/nodes/boarding areas.
// location_type 0 (stop/platform) and 1 (station) are shown; 2,3,4 are excluded.
function isStopLevel(r: RawStop): boolean {
  const lt = r.attributes?.location_type;
  return lt === 0 || lt === 1 || lt === undefined; // undefined defaults to a stop
}

// Pure: given raw stops (+ an included route map) and the origin, produce de-duplicated Stop[].
export function shapeStops(
  raw: RawStop[],
  routes: Map<string, RawRoute>,
  origin: { lat: number; lon: number },
): Stop[] {
  const byName = new Map<string, Stop>();

  for (const r of raw) {
    if (!isStopLevel(r)) continue;
    const name = r.attributes?.name?.trim();
    const lat = r.attributes?.latitude;
    const lon = r.attributes?.longitude;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const walkMi = haversineMi(origin.lat, origin.lon, lat as number, lon as number);
    const parentId = r.relationships?.parent_station?.data?.id;
    const routeId = r.relationships?.route?.data?.id;
    const line = routeId ? lineFromRoute(routes.get(routeId)) : null;

    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, {
        id: parentId ?? r.id,              // prefer the parent station id (e.g. "place-...")
        name,
        routeType: (line?.routeType ?? 3) as RouteType,
        lines: line ? [line.line] : [],
        wheelchair: wheelchairFrom(r.attributes?.wheelchair_boarding),
        walkMi,
      });
    } else {
      // de-dupe by name: keep the nearest point, merge lines, upgrade unknown accessibility.
      if (walkMi < existing.walkMi) existing.walkMi = walkMi;
      if (line && !existing.lines.some((l) => l.name === line.line.name)) {
        existing.lines.push(line.line);
      }
      if (existing.wheelchair === null) {
        existing.wheelchair = wheelchairFrom(r.attributes?.wheelchair_boarding);
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.walkMi - b.walkMi);
}

function lineFromRoute(route?: RawRoute): { line: Line; routeType: number } | null {
  if (!route) return null;
  const name = route.attributes?.long_name || route.attributes?.short_name || route.id;
  const color = route.attributes?.color ? `#${route.attributes.color}` : "#7C878E";
  return { line: { name, color }, routeType: route.attributes?.type ?? 3 };
}

// The only I/O. Converts the radius to degrees at the boundary, bounds the page size, degrades to
// [] on any failure so the UI shows the no-transit state (never throws out of here).
export async function nearestStops(
  lat: number,
  lon: number,
  radiusMi: number,
  limit = 3,
): Promise<Stop[]> {
  const params = new URLSearchParams({
    "filter[latitude]": String(lat),
    "filter[longitude]": String(lon),
    "filter[radius]": String(milesToMbtaDegrees(radiusMi)),
    "filter[route_type]": "0,1,2,3",
    include: "route",
    "page[limit]": "200", // bound the ~161 KB / 261-stop payload the probe returned
  });
  if (process.env.MBTA_API_KEY) params.set("api_key", process.env.MBTA_API_KEY);

  try {
    const res = await fetch(`${MBTA_BASE}/stops?${params}`, {
      headers: { accept: "application/vnd.api+json" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return [];
    const body = await res.json();
    const raw: RawStop[] = Array.isArray(body?.data) ? body.data : [];
    const routes = new Map<string, RawRoute>(
      (Array.isArray(body?.included) ? body.included : [])
        .filter((x: { type?: string }) => x?.type === "route")
        .map((x: RawRoute) => [x.id, x]),
    );
    return shapeStops(raw, routes, { lat, lon }).slice(0, limit);
  } catch {
    return []; // timeout / network / rate-limit -> no-transit fallback (Req 8.2)
  }
}
```

> Notes. `shapeStops`, `milesToMbtaDegrees`, and `wheelchairFrom` are **pure** and belong in a
> co-located `lib/mbta.test.ts` (structure.md). The `location_type` filter keeps 0/1 and drops
> 2/3/4 (Req 3); the parent-station id is preferred so one physical station is one row (Req 3.2,
> 4.1). De-duplication is by trimmed name with line-merge and nearest-point `walkMi` (Req 4).
> `wheelchairFrom` maps only 1→true and 2→false; **0 and missing both become `null`** (Req 7.3),
> which the `<Access>` component already renders as "access unknown".

### Draft 2 — `app/api/trials/[nct]/route.ts` (Hasan): include stops in the detail

```ts
// Inside GET /api/trials/[nct], after the facility-corrected site is known:
import { nearestStops } from "@/lib/mbta";

const site = facilityCorrected(trial.nearestSite); // see trial-search-api spec
const stops = await nearestStops(site.lat, site.lon, Math.max(radiusMi ?? 5, 1));
// ...return { ...detail, stops } — lib/data.ts toDetail already defends the shape.
```

> The route must never let an MBTA failure break the trial page: `nearestStops` already returns
> `[]` on error, and `toDetail` tolerates an empty/missing `stops` array, so the page falls back to
> the no-transit state (Req 8.2).

### Draft 3 — `lib/geo.ts` (Neil): driving-directions URL for the no-transit case

```ts
// Mirror of transitDirectionsUrl, but travelmode=driving — used when no stop is in range (Req 6.3).
export function drivingDirectionsUrl(
  dest: { lat: number; lon: number },
  origin?: { lat: number; lon: number },
): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${dest.lat},${dest.lon}`,
    travelmode: "driving",
  });
  if (origin) params.set("origin", `${origin.lat},${origin.lon}`);
  return `https://www.google.com/maps/dir/?${params}`;
}
```

### Draft 4 — `components/GettingThere.tsx` (Neil): show the driving link when empty

```diff
+import { formatMiles, transitDirectionsUrl, drivingDirectionsUrl } from "@/lib/geo";
   const nearest = [...stops].sort((a, b) => a.walkMi - b.walkMi).slice(0, 3);
+  const hasTransit = nearest.length > 0;
...
-      {nearest.length === 0 ? (
+      {!hasTransit ? (
         <p className="mt-2 text-ink">{t("go.noStops")}</p>
       ) : (
         ...list...
       )}
...
       <a
-        href={transitDirectionsUrl(site, origin)}
+        href={(hasTransit ? transitDirectionsUrl : drivingDirectionsUrl)(site, origin)}
         target="_blank"
         rel="noopener noreferrer"
         className="no-print mt-4 inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-5 text-base font-medium text-white hover:bg-primary-hover"
       >
-        {t("go.directions")}
+        {t(hasTransit ? "go.directions" : "go.drivingDirections")}
       </a>
```

### Draft 5 — `lib/i18n/en.ts` (Neil): one new key (≤ 8th grade, no forbidden phrases)

```diff
   "go.directions": "Directions by bus or train (opens Google Maps)",
+  "go.drivingDirections": "Driving directions (opens Google Maps)",
   "go.approx": "These stops are near the area, not the exact building.",
```

> The non-English dictionaries mirror this key; per safety.md add each translation before the
> language ships, and run the copy-guard hook on the new string. The copy has no forbidden phrases
> and reads below 8th grade.

### Blast radius summary

| File | Owner | Change | Gap |
|------|-------|--------|-----|
| `lib/mbta.ts` (new) | Hasan | `nearestStops` + pure `shapeStops`/`milesToMbtaDegrees`/`wheelchairFrom` | G1, G2, G3 |
| `lib/mbta.test.ts` (new) | Hasan | co-located unit tests for the pure functions | G1 |
| `app/api/trials/[nct]/route.ts` | Hasan | call `nearestStops`, include `stops` in the detail | G1, G3 |
| `lib/geo.ts` | Neil | add `drivingDirectionsUrl` | G4 |
| `components/GettingThere.tsx` | Neil | driving link + copy key in the empty state | G4 |
| `lib/i18n/en.ts` (+ other dicts) | Neil | add `go.drivingDirections` (+ translations before ship) | G5 |
| `tests/` property test | Akash | `milesToMbtaDegrees` monotonic & non-negative; `wheelchairFrom` only 1/2 true/false | G1 |

## Design decisions and rationale

- **Why de-dupe by name, not by id?** The probe showed the same station **name** recurring across
  entrances, platforms, and boarding areas with different ids. De-duplicating by trimmed name
  collapses them to one row per station (Req 4.4); keeping the parent-station id as the row id
  preserves a stable key and the `place-...` identity.
- **Why keep `location_type` 0 and 1 and drop 2/3/4?** Platforms (0) and stations (1) are the
  stops a rider targets; entrances (2), generic nodes (3), and boarding areas (4) are sub-features
  of a station and would bloat the list (Req 3). Undefined defaults to a stop so a sparse record is
  not silently dropped.
- **Why map only 1 and 2, and send 0/missing to `null`?** The probe saw only 1 (accessible) and 2
  (not accessible), but MBTA documents 0 (no info). Guessing either way would mislead a wheelchair
  user, so 0 and any missing/unknown value become `null` → the UI's explicit "access unknown"
  state (Req 7.3). `<Access>` and the ♿ icon's screen-reader text already exist, so no UI change is
  needed for accessibility.
- **Why bound the page size even though the UI slices to three?** The cap is about payload, not
  display: one site returned ~161 KB / 261 raw stops. `page[limit]` keeps the fetch and the shaping
  cheap for the demo (Req 2.1) before the `.slice(0, 3)` ever runs.
- **Why does `nearestStops` return `[]` on failure instead of throwing?** structure.md requires an
  explicit no-transit / error state, and the trial page must not break on an MBTA outage or
  rate-limit. Returning `[]` routes every failure into the one no-transit UI path (message +
  driving link) that the empty-stops case already uses (Req 8.1, 8.2).
- **Why a separate driving URL rather than reusing the transit one?** Google Maps `travelmode`
  differs; a transit link with no nearby transit is unhelpful. A sibling `drivingDirectionsUrl`
  keeps `lib/geo.ts` pure and mirrors the existing transit helper exactly, so the only UI change is
  which builder the empty state calls (Req 6.3).
- **Why keep it owner-authored?** The MBTA client is Hasan's per structure.md and the geo/UI/i18n
  edits are Neil's; authoring the drafts here (rather than editing those files) keeps the ownership
  map and the Kiro-workflow history clean, exactly as the fit-check Requirement 7 change was handed
  to its owner.
