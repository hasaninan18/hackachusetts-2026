# Requirements — trial-search-api

TrialPath MA backend for **step 2** of Hasan's track in `docs/TASKS.md`: the trial-search
API. It proxies ClinicalTrials.gov API v2, keeps only recruiting Massachusetts sites,
corrects the well-known Boston geoPoint bug (`docs/DEMO_DATA.md`), and returns a slim,
nearest-first list of trials plus a per-trial detail endpoint.

This spec owns **only new files** under `app/api/**` and `lib/**`. It reuses Neil's
`lib/types.ts` and `lib/geo.ts` and must not modify any of his files
(`types.ts`, `geo.ts`, `quickCheck.ts`, `simplify.ts`, `i18n/**`, `mock/**`) — the frontend
is being rebuilt on another branch. See folder ownership in `.kiro/steering/structure.md`.

## Scope

- `GET /api/trials?cond=&lat=&lon=&radius=` — search.
- `GET /api/trials/[nct]` — one trial's full detail.
- New pure logic in `lib/`: `lib/clinicaltrials.ts` (parse/slim/rank), `lib/facilities.ts`
  (Boston coordinate override), and response types in `lib/api-types.ts`.
- Out of scope: MBTA stops (`getting-there` spec), Bedrock/`/api/simplify` (`simplify` spec),
  any UI. The detail endpoint returns `stops: []` here; `getting-there` fills it in.

## Non-functional (from steering)

- Pure functions in `lib/` do no I/O (no `fetch`, no clock, no randomness); route handlers
  do all I/O and delegate parsing/ranking to `lib/`. (`structure.md`)
- `lib/` is canonical **miles**; all distance math returns miles. (`structure.md`)
- Never imply eligibility; no forbidden phrases; preserve NCT IDs, phones, emails verbatim.
  This API does not generate user-facing prose, but it must not alter contact identifiers.
  (`safety.md`)
- Tests live **next to** the code (`lib/foo.test.ts`), using Vitest + fast-check. (`structure.md`)

---

## Requirement 1 — Search endpoint

**User story:** As a patient, I want to search recruiting MA trials by condition, location,
and max distance, so I see the closest ones first.

#### Acceptance criteria

1. WHEN a client sends `GET /api/trials` with `cond`, `lat`, `lon`, and `radius`, THE SYSTEM SHALL call ClinicalTrials.gov API v2 `https://clinicaltrials.gov/api/v2/studies` with `query.cond={cond}`, `filter.overallStatus=RECRUITING`, `filter.geo=distance({lat},{lon},{radius}mi)`, `pageSize=50`, and a `fields` list limited to: NCTId, BriefTitle, Condition, Phase, BriefSummary, EligibilityModule, LocationFacility, LocationCity, LocationState, LocationGeoPoint, LocationStatus, LocationContactName, LocationContactPhone, LocationContactEMail, CentralContactName, CentralContactPhone, CentralContactEMail.
2. THE SYSTEM SHALL default `radius` to **at least 5 miles** (5 mi) WHEN `radius` is missing, non-numeric, or below 5, because the Boston centroid sits ~4 mi from Dorchester and smaller radii drop every Boston trial (`docs/DEMO_DATA.md`).
3. WHEN the upstream response is received, THE SYSTEM SHALL keep only sites whose `status === "RECRUITING"` AND `state === "Massachusetts"`, and SHALL drop trials left with no qualifying MA site.
4. THE SYSTEM SHALL return each trial slimmed to `{ nctId, title, conditions, phase, nearestSite, distanceMi }` matching `TrialSummary` in `lib/types.ts`, with `distanceMi` computed in miles from the search `(lat, lon)` to the trial's **nearest corrected** site.
5. THE SYSTEM SHALL sort the returned trials nearest-first by `distanceMi` ascending.
6. THE SYSTEM SHALL respond `{ trials, total }` matching `TrialsResponse` in `lib/types.ts`, with `Content-Type: application/json`.
7. IF `lat` or `lon` is missing or non-numeric, THEN THE SYSTEM SHALL respond `400` with a JSON error body and SHALL NOT call the upstream API.
8. IF `cond` is missing or empty, THEN THE SYSTEM SHALL treat it as an empty condition query (search by location only) rather than error.

## Requirement 2 — Trial detail endpoint

**User story:** As a patient, I want full details for one trial so I can read its summary,
eligibility, sites, and contacts.

#### Acceptance criteria

1. WHEN a client sends `GET /api/trials/[nct]`, THE SYSTEM SHALL call ClinicalTrials.gov API v2 for that single study by NCT ID and return a `TrialDetail` (`lib/types.ts`): `TrialSummary` plus `briefSummary`, `eligibility`, `sites`, `contacts`, and `stops`.
2. THE SYSTEM SHALL apply the same Boston coordinate correction (Requirement 4) and MA-recruiting site filter (Requirement 1.3) before choosing `nearestSite` and populating `sites`.
3. WHEN the detail endpoint cannot compute a search distance (no `lat`/`lon` query param), THE SYSTEM SHALL set `distanceMi` to `0` and `nearestSite` to the first qualifying corrected site; WHEN `lat`/`lon` are provided, it SHALL compute distance and nearest site as in search.
4. THE SYSTEM SHALL return `stops: []` in this spec (the `getting-there` spec adds MBTA stops) so the `TrialDetail` contract stays satisfiable.
5. IF no study matches the NCT ID, THEN THE SYSTEM SHALL respond `404` with a JSON error body.
6. THE SYSTEM SHALL build `eligibility` from the API: `minAgeYears`/`maxAgeYears` via `parseAge`, `sex` (`ALL|FEMALE|MALE`), `healthyVolunteers` (boolean), and `criteriaText`.
7. THE SYSTEM SHALL build `contacts` from the study's **central contacts** when present; WHEN there is no central contact (or none with a phone or email), THE SYSTEM SHALL fall back to the **site/location contacts** (`LocationContactName`/`LocationContactPhone`/`LocationContactEMail`), preferring the qualifying MA site(s). In both cases it SHALL prefer entries that have a phone or email, drop `PRINCIPAL_INVESTIGATOR` entries with neither, and pass phone and email strings through unchanged (`safety.md` §5, `docs/BACKEND_NOTES.md` §5).

## Requirement 3 — Boston geoPoint fix (`lib/facilities.ts`)

**User story:** As a user near a specific Boston hospital, I want distances and (later) transit
measured from the real building, not the shared city centroid, so results are correct.

#### Acceptance criteria

1. THE SYSTEM SHALL add `lib/facilities.ts` with a facility-coordinate override table containing the corrected coordinates from `docs/DEMO_DATA.md` ("Use" column): Boston Medical Center `42.3350, -71.0728`; Brigham and Women's `42.3355, -71.1067`; BIDMC `42.3396, -71.1066`; MGH `42.3625, -71.0694`; Boston Children's `42.3377, -71.1057`.
2. THE SYSTEM SHALL expose a pure function that, given a site's facility name and its API `geoPoint`, returns corrected `{ lat, lon }` plus a `locationPrecision` of `"facility" | "zip" | "city"`.
3. WHEN a site's geoPoint equals the Boston centroid `42.35843, -71.05977` (within a small epsilon), THE SYSTEM SHALL attempt a name match and, on a hit, return the override coordinates with precision `"facility"`.
4. THE SYSTEM SHALL normalize facility names for matching: lowercase, replace `&` with `and`, strip punctuation, collapse whitespace, then substring-match the aliases from `docs/DEMO_DATA.md` — `"brigham"`, `"boston medical center"`, `"beth israel"`/`"bidmc"`, `"massachusetts general"`/`"mgh"`, `"boston children"`.
5. WHEN the geoPoint is the Boston centroid but no facility name matches, THE SYSTEM SHALL leave the coordinates as the city centroid with precision `"city"` (the `getting-there`/frontend layer may later substitute a ZIP centroid; this spec does not depend on ZIP data).
6. WHEN the geoPoint is NOT the Boston centroid, THE SYSTEM SHALL keep the API coordinates with precision `"facility"` (the API already geocoded a real point) — matching `Site.locationPrecision` in `lib/types.ts`.
7. THE override and matching logic SHALL be a **pure function** with no I/O, callable from both route handlers.

## Requirement 4 — Nearest-site selection and ranking

**User story:** As a user, I want each trial to report its single closest MA site and that
distance, so the list is ordered the way I expect.

#### Acceptance criteria

1. THE SYSTEM SHALL provide a pure `nearestSite(sites, origin)` that returns the corrected MA site with the smallest `haversineMi` distance (from `lib/geo.ts`) to `origin`, in miles.
2. THE SYSTEM SHALL provide a pure `slimStudy(rawStudy, origin)` that applies site correction + filtering, selects the nearest site, and returns a `TrialSummary`.
3. THE SYSTEM SHALL provide a pure `rankBySiteDistance(trials)` (or equivalent) returning trials sorted by `distanceMi` ascending, stable for ties.
4. All distance values returned by `lib/` functions SHALL be in miles (`structure.md`).

## Requirement 5 — API response types (`lib/api-types.ts`)

**User story:** As a developer, I want the API's internal/response shapes typed in one new
file so route handlers and tests share a contract without editing Neil's `types.ts`.

#### Acceptance criteria

1. THE SYSTEM SHALL add `lib/api-types.ts` containing: the raw ClinicalTrials.gov v2 shapes consumed (`CtgStudiesResponse`, `CtgStudy`, module/location/contact shapes as used), an `ApiError` body type, and re-exports or aliases of the response contracts (`TrialsResponse`, `TrialSummary`, `TrialDetail`) from `lib/types.ts` so handlers import response types from one place.
2. `lib/api-types.ts` SHALL NOT redefine or shadow the domain types owned by `lib/types.ts`; it SHALL import them.
3. THE raw upstream types SHALL cover exactly the `fields` requested in Requirement 1.1 (no speculative fields).

## Requirement 6 — Upstream caching

**User story:** As the team, we want upstream responses cached briefly so the live demo is fast
and survives rate limits.

#### Acceptance criteria

1. THE SYSTEM SHALL cache upstream ClinicalTrials.gov responses for **10 minutes**, keyed by the request (search params for search; NCT ID for detail).
2. WHEN a cached entry is fresh (< 10 min old), THE SYSTEM SHALL serve from cache without calling upstream.
3. THE cache SHALL live in the route/I-O layer, not in the pure `lib/` functions.
4. IF the upstream call fails or times out, THEN THE SYSTEM SHALL respond with a JSON error body and an appropriate status (e.g. `502`/`504`), and SHALL serve a fresh-enough cached entry when one exists.

## Requirement 7 — Tests (unit + property, NCT IDs from DEMO_DATA.md)

**User story:** As the team, we want the pure logic covered by unit and property tests using
the demo NCT IDs, so the Boston fix and ranking are provably correct.

#### Acceptance criteria

1. THE SYSTEM SHALL add co-located tests: `lib/facilities.test.ts` and `lib/clinicaltrials.test.ts` (Vitest + fast-check).
2. THE tests SHALL use the demo NCT IDs from `docs/DEMO_DATA.md` as fixtures/cases: `NCT07043426` (THRIVE-DM, BMC), `NCT05784922` (lung screening, MGH), `NCT07719049` (FaceAge, BWH), `NCT06610448` (wearable BP, BIDMC), `NCT06432790` (CHAMPION, MGH).
3. Unit: a BMC site with the Boston centroid geoPoint and facility name "Boston Medical Center" SHALL correct to `42.3350, -71.0728` with precision `"facility"`; each of the five hospital aliases SHALL map to its DEMO_DATA override.
4. Property (fast-check): facility correction never throws on arbitrary name/coordinate input; a non-centroid coordinate is returned unchanged; `nearestSite` returns a site whose distance is ≤ every other site's distance; the search result list is always sorted non-decreasing by `distanceMi`.
5. Property: `distanceMi` is always finite and non-negative; correcting a Boston-centroid BMC site then measuring from Dorchester `(42.3016, -71.0676)` yields a distance **smaller** than measuring from the uncorrected centroid (demonstrates the radius bug fix).
6. Tests SHALL NOT make network calls; upstream JSON SHALL be provided as in-repo fixtures.
