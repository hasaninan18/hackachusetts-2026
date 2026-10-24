# Requirements — getting-there (MBTA transit)

## Introduction

TrialPath MA tells a patient how to reach a trial site by the T. For a single
trial detail (`GET /api/trials/[nct]`), we add the nearest MBTA stops — name,
route type, wheelchair accessibility, and walking distance — plus a Google Maps
transit directions link, all anchored on the site's **corrected** coordinates.

This feature adds `lib/mbta.ts` (the MBTA V3 client + pure parse/rank helpers)
and wires its output into the existing detail route. It must never degrade the
already-shipped ClinicalTrials.gov search/detail behavior or the Boston
facility-coordinate fix (`lib/facilities.ts`): if MBTA is slow, down, or returns
junk, the trial detail still returns with `stops: []`.

The MBTA `/stops` contract was live-probed on 2026-10-24 (see design.md
"Live-probe findings"); requirements below reflect what the API actually returns,
not assumptions.

## Requirements

### Requirement 1 — Use corrected site coordinates
**User story:** As a patient, I want nearby stops measured from the real hospital
building, not the shared Boston city centroid, so the walking distances are true.

#### Acceptance criteria
1. WHEN the route requests nearby stops THEN it SHALL use the **corrected** site
   coordinates produced by `lib/facilities.ts` (`correctCoordinates`), the same
   coordinates already on the response's `nearestSite`/`sites`.
2. The system SHALL NEVER query MBTA with the uncorrected Boston centroid
   (42.35843, -71.05977) when a corrected facility coordinate is available.
3. WHEN no origin is supplied to the detail route THEN stops SHALL be measured
   from the chosen site's corrected coordinates (the first qualifying site).

### Requirement 2 — MBTA V3 query shape (from live probe)
**User story:** As a developer, I want the MBTA query to match what the live V3
API actually honors, so results are correct and bounded.

#### Acceptance criteria
1. The client SHALL call `https://api-v3.mbta.com/stops` with
   `filter[latitude]`, `filter[longitude]`, `filter[radius]` (degrees),
   `filter[location_type]=0,1`, `filter[route_type]=0,1,2,3`, an explicit
   `page[limit]`, and `sort=distance`.
2. The radius SHALL be derived from a miles budget via a pure mile→degree
   conversion (~0.01° ≈ 0.7 mi) at the I/O boundary only.
3. Route/line **labels** SHALL reflect the verified API behavior: the `/stops`
   endpoint does NOT expose a `route` relationship (confirmed — `include=route`
   adds nothing and stops carry only `facilities`/`parent_station`/`zone`
   relationships). The feature SHALL therefore populate `lines: []` and derive
   `routeType` from each stop's `vehicle_type` attribute, rather than
   fabricating line names. (Adding per-stop line labels would require a separate
   `/routes?filter[stop]=` call per stop; that is out of scope for this round
   and is recorded as a possible follow-up.)

### Requirement 3 — De-dup, rank, distance
**User story:** As a patient, I want a short, non-repetitive list of the closest
stops with honest walking distances.

#### Acceptance criteria
1. WHEN two returned stops share the same `name` THEN the system SHALL keep only
   the nearest one (de-dup by name).
2. The system SHALL return at most **three** stops, nearest first.
3. Walking distance SHALL be computed in **miles** using the existing
   `haversineMi` helper in `lib/geo.ts`. The feature SHALL NOT reimplement
   haversine.

### Requirement 4 — Wheelchair accessibility honesty
**User story:** As a wheelchair user, I must never be told a stop is accessible
when the data does not say so.

#### Acceptance criteria
1. WHEN `wheelchair_boarding === 1` THEN `wheelchair` SHALL be `true` (accessible).
2. WHEN `wheelchair_boarding === 2` THEN `wheelchair` SHALL be `false` (not accessible).
3. WHEN `wheelchair_boarding === 0`, missing, or non-numeric THEN `wheelchair`
   SHALL be `null` (unknown).
4. The system SHALL NEVER present unknown (0/missing) as accessible.

### Requirement 5 — Populate the stops contract + directions link
**User story:** As a patient, I want the stops in the trial detail and a one-tap
transit directions link.

#### Acceptance criteria
1. The system SHALL populate the existing `TrialDetail.stops: Stop[]` contract
   (`lib/types.ts` — `{ id, name, routeType, lines, wheelchair, walkMi }`). No
   shared-type change is required: the `Stop` shape already fits the probe data,
   with `lines: []`.
2. The stop `id` SHALL be the parent-station id when the stop has one
   (`relationships.parent_station.data.id`, e.g. `place-chmnl`), else the stop's
   own id — matching the `Stop.id` contract comment.
3. The Google Maps transit link
   `https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=transit`
   SHALL use the **corrected** site coordinates. The link is derived on the
   frontend from the response's corrected `site` via `transitDirectionsUrl`
   (`lib/geo.ts`); the backend's responsibility is to ensure the response carries
   corrected site coordinates (already satisfied by `toDetail`). No new response
   field is added.

### Requirement 6 — MBTA failure must not break trial details
**User story:** As a patient, I want to still see the trial even when transit
data is unavailable.

#### Acceptance criteria
1. WHEN the MBTA request times out THEN the detail response SHALL still return
   with `stops: []`.
2. WHEN the MBTA request fails (network error / non-OK status) THEN the detail
   response SHALL still return with `stops: []`.
3. WHEN MBTA returns malformed data (missing `data`, missing attributes,
   non-numeric coordinates) THEN the system SHALL skip the bad entries and never
   throw; a totally unusable payload yields `stops: []`.
4. WHEN there are no nearby stops THEN `stops` SHALL be `[]`.
5. The ClinicalTrials.gov detail (title, eligibility, sites, contacts) SHALL be
   unaffected by any MBTA outcome.

### Requirement 7 — I/O isolation, timeouts, cache
**User story:** As a developer, I want network in the I/O layer and pure,
testable ranking logic.

#### Acceptance criteria
1. Network access SHALL live in the I/O layer (the fetcher in `lib/mbta.ts`,
   invoked by the route handler). Parsing and ranking functions SHALL be pure
   (no fetch, clock, or randomness) and total (never throw on bad input).
2. The MBTA fetch SHALL use a bounded timeout via `AbortController`.
3. The MBTA fetch SHALL reuse the existing cache conventions (`lib/cache.ts`,
   `cachedFetchJson`), keyed by the MBTA request URL, so repeated detail loads
   for a demo trial do not re-hit the network within the TTL.

### Requirement 8 — Do not regress prior work
**User story:** As the team, we must not break the completed search behavior or
the Faulkner/cache fixes.

#### Acceptance criteria
1. The feature SHALL NOT change `GET /api/trials` search behavior.
2. The feature SHALL NOT change `lib/facilities.ts`, `lib/clinicaltrials.ts`
   parse/rank logic, or `lib/types.ts`.
3. Existing detail-route tests SHALL continue to pass (a detail with no MBTA
   stops still returns `stops: []`).
