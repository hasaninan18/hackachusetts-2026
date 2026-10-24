# Tasks — trial-search-api

Only new files under `app/api/**` and `lib/**`. Reuse Neil's `lib/types.ts` and `lib/geo.ts`;
do not modify his files. Tests co-located (`lib/*.test.ts`), Vitest + fast-check. Each task
lists the requirements it satisfies.

- [ ] 1. Add response/raw types in `lib/api-types.ts`
  - Import (don't redefine) `TrialSummary`, `TrialDetail`, `TrialsResponse` from `lib/types.ts` and re-export them.
  - Add `ApiError` and the raw ClinicalTrials.gov v2 shapes covering only the requested fields: `CtgStudiesResponse`, `CtgStudy`, `CtgLocation`, `CtgContact`, `CtgEligibilityModule`, `CtgGeoPoint`.
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 2. Implement the Boston geoPoint fix in `lib/facilities.ts`
  - Export `BOSTON_CENTROID = { lat: 42.35843, lon: -71.05977 }` and `FACILITY_OVERRIDES` with the five DEMO_DATA "Use" coordinates + aliases (BMC, Brigham, BIDMC/Beth Israel, MGH/Massachusetts General, Boston Children's).
  - Implement `normalizeName` (lowercase, `&`→`and`, strip punctuation, collapse whitespace) and `isBostonCentroid(lat, lon)` with a small epsilon.
  - Implement pure `correctCoordinates(name, lat, lon) → { lat, lon, precision }`: non-centroid → `"facility"` with API coords; centroid + alias hit → override coords `"facility"`; centroid + no hit → centroid `"city"`; non-finite input → defensive `"city"`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 3. Unit + property tests for `lib/facilities.ts` (`lib/facilities.test.ts`)
  - Unit: each of the five aliases on a Boston-centroid site corrects to its DEMO_DATA override with precision `"facility"` (BMC → 42.3350,-71.0728; Brigham → 42.3355,-71.1067; BIDMC → 42.3396,-71.1066; MGH → 42.3625,-71.0694; Boston Children's → 42.3377,-71.1057).
  - Unit: centroid + unknown name → `"city"`; non-centroid coords → returned unchanged, `"facility"`.
  - Property (fast-check): `correctCoordinates` never throws on arbitrary strings/numbers; non-centroid coordinates are returned unchanged.
  - _Requirements: 7.1, 7.3, 7.4, 7.6_

- [ ] 4. Implement parse/slim/rank in `lib/clinicaltrials.ts`
  - `normalizeRadius(raw) → max(5, n)` (default ≥ 5 mi); `buildSearchUrl({cond,lat,lon,radius})` and `buildDetailUrl(nct)` with the exact params and `fields` list from Requirement 1.1.
  - `parseAge` (Years/Months/N/A/empty/junk → number|null, never throws), `parsePhase` (`["PHASE1","PHASE2"]`→"Phase 1/2", NA→null).
  - `correctSite`, `recruitingMaSites` (status RECRUITING + state Massachusetts), `nearestSite(sites, origin)` using `haversineMi` from `lib/geo.ts` (miles), `buildContacts` (prefer phone/email, drop PI-without-contact, values verbatim).
  - `slimStudy(rawStudy, origin) → TrialSummary | null`, `toDetail(rawStudy, origin) → TrialDetail` with `stops: []`, `rankBySiteDistance(trials)` ascending/stable.
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.8, 2.2, 2.3, 2.4, 2.6, 2.7, 3.*, 4.1, 4.2, 4.3, 4.4_

- [ ] 5. Unit + property tests for `lib/clinicaltrials.ts` (`lib/clinicaltrials.test.ts`)
  - Build in-repo fixtures for the five demo NCT IDs (`NCT07043426`, `NCT05784922`, `NCT07719049`, `NCT06610448`, `NCT06432790`), each with a Boston-centroid geoPoint and the real facility name.
  - Unit: `parseAge`/`parsePhase` cases; `slimStudy` on the BMC fixture yields corrected `nearestSite` + finite `distanceMi`; `nearestSite` returns the global minimum; `rankBySiteDistance` output is non-decreasing.
  - Property: `distanceMi` always finite and ≥ 0; search result list always sorted non-decreasing; Dorchester `(42.3016,-71.0676)` → corrected BMC distance **<** Dorchester → uncorrected centroid distance (radius-bug guard).
  - No network calls.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 6. Add the 10-minute upstream cache helper (I/O layer)
  - Small module-scope `Map` keyed by upstream URL (search) / NCT ID (detail), `CACHE_TTL_MS = 600_000`, checked against `Date.now()`; serve fresh entries without calling upstream.
  - Keep it in the route/I-O layer (new `lib/cache.ts` that takes the clock is fine); pure parse functions never import it.
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 7. Implement `GET /api/trials` in `app/api/trials/route.ts`
  - Parse `cond`, `lat`, `lon`, `radius`; `400` JSON `ApiError` if `lat`/`lon` missing/non-numeric (no upstream call); empty `cond` allowed.
  - `normalizeRadius` → `buildSearchUrl` → cached fetch → map `slimStudy(origin)` → drop nulls → `rankBySiteDistance` → respond `{ trials, total }` JSON.
  - Upstream failure → `502`/`504` JSON `ApiError`, serving a fresh cache entry if available.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 6.*_

- [ ] 8. Implement `GET /api/trials/[nct]` in `app/api/trials/[nct]/route.ts`
  - `buildDetailUrl` → cached fetch; `404` JSON if no study; else `toDetail(study, origin?)` (distance 0 + first corrected site when no lat/lon), respond `TrialDetail` JSON with `stops: []`.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 6.*_

- [ ] 9. Verify the whole spec
  - Run `npm run typecheck`, `npm run lint`, and `npm test` (vitest run); confirm no edits to Neil's files (`git diff --name-only` touches only `app/api/**`, `lib/api-types.ts`, `lib/facilities.ts`, `lib/clinicaltrials.ts`, their `.test.ts`, and optionally `lib/cache.ts`).
  - Spot-check `buildSearchUrl` output contains `filter.overallStatus=RECRUITING`, `filter.geo=distance(...,5mi)` for the default, and the exact `fields` list.
  - _Requirements: all_
```
