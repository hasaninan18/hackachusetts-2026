# Design — trial-search-api

## Overview

Two Next.js App Router route handlers do all I/O (fetch ClinicalTrials.gov, cache) and delegate
every parse/correct/rank decision to pure functions in `lib/`. This keeps the steering rule
"pure logic in `lib/`, I/O in routes" (`.kiro/steering/structure.md`) and makes the Boston
coordinate fix and ranking trivially property-testable.

```
app/api/trials/route.ts          GET /api/trials        (I/O: fetch + cache + validate params)
app/api/trials/[nct]/route.ts    GET /api/trials/[nct]  (I/O: fetch + cache + 404)
        │  delegates to
        ▼
lib/clinicaltrials.ts   buildSearchUrl, buildDetailUrl, parseAge, parsePhase,
                        correctSite (via facilities), nearestSite, slimStudy,
                        toDetail, rankBySiteDistance        ← PURE, no I/O
lib/facilities.ts       FACILITY_OVERRIDES, BOSTON_CENTROID, normalizeName,
                        correctCoordinates                  ← PURE, no I/O
lib/api-types.ts        raw CTG v2 shapes + ApiError + response-type re-exports
        │  reuses (never modifies)
        ▼
lib/types.ts (Neil)     Site, TrialSummary, TrialDetail, Eligibility, Contact, TrialsResponse
lib/geo.ts   (Neil)     haversineMi(lat1,lon1,lat2,lon2) → miles
```

### Boundaries we respect
- **`lib/types.ts` and `lib/geo.ts` are shared contracts between the frontend and the
  backend**, not private backend code. `lib/types.ts` is the HTTP contract the UI reads
  (`lib/data.ts` validates against it), and `lib/geo.ts` holds the canonical miles helpers
  both sides use. We **import and reuse** them and **never modify** them — changing either
  would silently break the frontend being rebuilt on another branch. Any new shape we need
  goes in `lib/api-types.ts` (importing/re-exporting from `lib/types.ts`), not into `types.ts`.
- **Do not modify** `lib/types.ts`, `lib/geo.ts`, `lib/quickCheck.ts`, `lib/simplify.ts`,
  `lib/i18n/**`, `lib/mock/**`. Only add new files. (`structure.md` ownership, user instruction.)
- Response contract is Neil's `lib/types.ts` (`TrialSummary`, `TrialDetail`, `TrialsResponse`).
  `lib/data.ts` already validates these shapes, so matching them keeps the UI working.
- `stops` is out of scope here → `[]`; the `getting-there` spec populates it.

## Components

### `lib/facilities.ts` (the Boston geoPoint fix)

```ts
export const BOSTON_CENTROID = { lat: 42.35843, lon: -71.05977 } as const;

// Corrected "Use" coordinates from docs/DEMO_DATA.md.
interface FacilityOverride { lat: number; lon: number; aliases: string[]; }
export const FACILITY_OVERRIDES: FacilityOverride[] = [
  { lat: 42.3350, lon: -71.0728, aliases: ["boston medical center"] },
  { lat: 42.3355, lon: -71.1067, aliases: ["brigham"] },
  { lat: 42.3396, lon: -71.1066, aliases: ["beth israel", "bidmc"] },
  { lat: 42.3625, lon: -71.0694, aliases: ["massachusetts general", "mgh"] },
  { lat: 42.3377, lon: -71.1057, aliases: ["boston children"] },
];

// lowercase, "&"→"and", strip punctuation, collapse whitespace.
export function normalizeName(name: string): string;

// epsilon ~1e-3 deg (~0.07 mi) — the API value is a fixed constant, so this is exact-ish.
export function isBostonCentroid(lat: number, lon: number): boolean;

export interface CorrectedPoint { lat: number; lon: number; precision: Site["locationPrecision"]; }

// Rules (Requirement 3):
//  - not centroid        → { api coords, "facility" }
//  - centroid + name hit → { override coords, "facility" }
//  - centroid + no hit   → { centroid coords, "city" }
export function correctCoordinates(name: string, lat: number, lon: number): CorrectedPoint;
```

`correctCoordinates` is pure and total: any string + any finite numbers → a `CorrectedPoint`,
never throws. Non-finite inputs fall through to the `"city"` branch (defensive).

### `lib/clinicaltrials.ts` (parse / slim / rank)

Pure helpers, no `fetch`:

- `buildSearchUrl({ cond, lat, lon, radius })` → the ClinicalTrials.gov v2 URL string with the
  exact params and `fields` list from Requirement 1.1. `radius` normalized via `normalizeRadius`.
- `normalizeRadius(raw)` → `number`; returns `Math.max(5, n)` for finite `n ≥ 5`, else `5`
  (default ≥ 5 mi, Requirement 1.2).
- `buildDetailUrl(nctId)` → single-study URL (`query.id=NCTxx…` / `filter.ids`), same `fields`.
- `parseAge("18 Years" | "6 Months" | "N/A" | "" | junk)` → years as number or `null`; months →
  `/12` (6 Months → 0.5); never throws.
- `parsePhase(["PHASE2"])` → `"Phase 2"`, `["PHASE1","PHASE2"]` → `"Phase 1/2"`, `NA`/missing → `null`.
- `correctSite(rawLocation)` → `Site` using `correctCoordinates`; keeps `name`, `city`, `zip`.
- `recruitingMaSites(rawLocations)` → corrected `Site[]`, filtered to
  `status === "RECRUITING" && state === "Massachusetts"` (`BACKEND_NOTES.md` §2).
- `nearestSite(sites, origin)` → the `Site` minimizing `haversineMi`; `origin` optional (detail
  without lat/lon uses the first site, distance 0).
- `slimStudy(rawStudy, origin)` → `TrialSummary | null` (null when no qualifying MA site).
- `toDetail(rawStudy, origin)` → `TrialDetail` with `eligibility`, `sites`, `contacts`,
  `stops: []`.
- `buildContacts(centralContacts, maSites)` → `Contact[]`: use the study's central contacts
  when any has a phone/email; otherwise fall back to the site/location contacts
  (`LocationContactName`/`Phone`/`EMail`) from the qualifying MA sites. In both cases prefer
  entries with a phone or email, drop PI-without-contact, keep values verbatim (`safety.md` §5,
  `BACKEND_NOTES.md` §5).
- `rankBySiteDistance(trials)` → sorted copy, ascending `distanceMi`, stable.

### `lib/api-types.ts`

Raw upstream shapes covering only the requested fields, plus error + response re-exports:

```ts
import type { TrialSummary, TrialDetail, TrialsResponse } from "./types";
export type { TrialSummary, TrialDetail, TrialsResponse };

export interface ApiError { error: string; }

export interface CtgGeoPoint { lat: number; lon: number; }
export interface CtgLocation {
  facility?: string; city?: string; state?: string; zip?: string;
  status?: string; geoPoint?: CtgGeoPoint;
  contacts?: CtgContact[]; // LocationContactName/Phone/EMail — site-level fallback
}
export interface CtgContact { name?: string; phone?: string; email?: string; role?: string; }
export interface CtgEligibilityModule {
  eligibilityCriteria?: string; sex?: string;
  minimumAge?: string; maximumAge?: string; healthyVolunteers?: boolean;
}
export interface CtgStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    conditionsModule?: { conditions?: string[] };
    designModule?: { phases?: string[] };
    descriptionModule?: { briefSummary?: string };
    eligibilityModule?: CtgEligibilityModule;
    contactsLocationsModule?: { locations?: CtgLocation[]; centralContacts?: CtgContact[] };
  };
}
export interface CtgStudiesResponse { studies?: CtgStudy[]; totalCount?: number; }
```

### Route handlers (I/O layer)

`GET /api/trials` — validate `lat`/`lon` (400 if bad), `normalizeRadius`, `buildSearchUrl`,
fetch through the 10-min cache, map `studies` with `slimStudy(origin)`, drop nulls,
`rankBySiteDistance`, respond `{ trials, total }`.

`GET /api/trials/[nct]` — `buildDetailUrl`, fetch through cache, 404 if `studies` empty,
else `toDetail(study, origin?)`, respond `TrialDetail`.

Upstream failure → `502`/`504` JSON `ApiError`, serving a fresh cache entry if present.

### Caching

A tiny module-scope `Map<string, { at: number; body: unknown }>` with a 10-minute TTL
(`CACHE_TTL_MS = 600_000`), checked against `Date.now()`. Lives in the route/I-O layer
(a small `lib/` helper that takes the clock is acceptable, but the pure parse functions never
touch it). Keys: the full upstream URL (search) / NCT ID (detail).

## Data notes applied (from docs/BACKEND_NOTES.md + DEMO_DATA.md)
- Every Boston site returns `42.35843,-71.05977`; corrected per Requirement 3.
- Filter sites by their **own** `status`, not just the trial's overall status.
- MBTA/stops, lines, and ZIP-centroid fallback are deferred to later specs.
- Phone/email strings pass through untouched.

## Error / edge handling
- Missing `cond` → empty condition (location-only search), not an error.
- Study with zero qualifying MA sites → dropped from search; detail returns what it has but
  `sites` may be `[]` (UI tolerates via `lib/data.ts`).
- Non-finite coordinates anywhere → defensive `"city"` fallback, no throw.

## Testing strategy
- `lib/facilities.test.ts`: unit cases for all five hospital aliases → DEMO_DATA overrides;
  non-centroid passthrough; no-match → `"city"`. Property: `correctCoordinates` total/never
  throws; non-centroid coords unchanged.
- `lib/clinicaltrials.test.ts`: fixtures built from the five demo NCT IDs; `parseAge` /
  `parsePhase` units; `nearestSite` returns the global min; `rankBySiteDistance` output
  non-decreasing. Property: `distanceMi` finite & ≥ 0; Dorchester-to-corrected-BMC distance
  < Dorchester-to-centroid distance (the radius-bug regression guard).
- Vitest, co-located, no network (in-repo fixtures). `npm test` (`vitest run`).
```
