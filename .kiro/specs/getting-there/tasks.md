# Tasks — getting-there (MBTA transit)

- [ ] 1. Live-probe MBTA V3 and record findings
  - Call the real `/stops` endpoint for BMC corrected coords; verify params,
    route relationships, `vehicle_type`, `parent_station`, `wheelchair_boarding`.
  - Record observed stop names + accessibility in design.md.
  - _Requirements: 2.1, 2.3, 4_

- [ ] 2. Pure helpers in `lib/mbta.ts`
  - [ ] 2.1 `milesToMbtaDegrees` (unit boundary; monotonic, non-negative).
  - [ ] 2.2 `buildStopsUrl` with probe-verified params + explicit `page[limit]`.
  - [ ] 2.3 `parseWheelchair` (1→true, 2→false, 0/missing/junk→null).
  - [ ] 2.4 `toRouteType` (0..3 → RouteType, else null).
  - [ ] 2.5 `stopFromRaw` (parent-station id, `walkMi` via `haversineMi`, `lines: []`).
  - [ ] 2.6 `rankStops` (de-dup by name keep-nearest, sort asc, take 3).
  - _Requirements: 1, 2, 3, 4, 7.1_

- [ ] 3. I/O: `fetchNearbyStops`
  - Build URL, fetch via `cachedFetchJson` with bounded `AbortController` timeout,
    parse with `rankStops`, resolve `[]` on any failure/timeout/malformed body.
  - _Requirements: 2, 6, 7.2, 7.3_

- [ ] 4. Wire into `app/api/trials/[nct]/route.ts`
  - After `toDetail`, fetch stops for the anchor site's corrected coords and set
    `detail.stops`; isolate failures so the 200 detail always returns.
  - _Requirements: 1, 5, 6, 8_

- [ ] 5. Tests (`lib/mbta.test.ts` + extend route test)
  - Parsing, distance ordering, duplicate-name de-dup, wheelchair 0/1/2/missing,
    upstream failure (reject/non-OK/abort/malformed). All network mocked.
  - Route: MBTA failure → 200 with `stops: []`; MBTA success → populated stops.
  - _Requirements: 3, 4, 6, 8.3_

- [ ] 6. Verify: `npm run typecheck`, `npm run lint`, vitest on changed files +
  full suite (note the 5 pre-existing i18n failures). Commit + push
  `feat/getting-there`.
