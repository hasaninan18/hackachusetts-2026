# Requirements — getting-there

## Introduction

The getting-there feature helps a person reach a specific trial site without a car. For a site's
latitude/longitude it queries the MBTA V3 `/stops` endpoint, slims and de-duplicates the result
into a short list of the nearest real stations, and shows each stop's name, the lines it serves,
its wheelchair-boarding status, and the walking distance in miles. It always offers a Google Maps
transit directions link. When no stop is within the search radius, it tells the person there is no
nearby transit and offers a driving directions link instead.

This spec is grounded in the code that exists today:

- `components/GettingThere.tsx` — the presentational component. It takes an already-shaped
  `stops: Stop[]`, sorts by `walkMi`, slices to the **three** nearest, and renders each stop's
  name, its `LineChip`s, the walk distance via `formatMiles`, and an `Access` sub-component that
  maps `wheelchair` `true | false | null`. It renders the empty state from `go.noStops` and always
  renders a single directions link built by `transitDirectionsUrl(site, origin)`. It shows the
  `go.approx` note when `site.locationPrecision !== "facility"`.
- `components/LineChip.tsx` — renders one `Line` as a white pill with a colour swatch; the swatch
  is `aria-hidden` and falls back to `#7C878E` when `line.color` is not a 6-digit hex.
- `lib/geo.ts` — `haversineMi` (distance in **miles**), `formatMiles` (`"< 0.1"` / one decimal /
  rounded), and `transitDirectionsUrl(dest, origin?)`, which always builds a Google Maps
  `travelmode=transit` URL (`api=1`, `destination`, optional `origin`).
- `lib/data.ts` — `toDetail` is the only place stops are shaped for the UI today. It keeps a
  `stops` array only when each entry has a string `name` and a finite `walkMi`, and defaults
  `lines` to `[]`. It performs **no** MBTA fetch; the `Stop[]` is expected from the
  `/api/trials/[nct]` route, which does not exist in the code visible to this spec.
- `lib/types.ts` — `Stop` is `{ id, name, routeType, lines, wheelchair, walkMi }` where
  `wheelchair: boolean | null` is documented as `wheelchair_boarding` 1 → true, 2 → false,
  0 → null; `Line` is `{ name, color }`; `RouteType` is `0 | 1 | 2 | 3`.
- `lib/i18n/en.ts` — the `go.*` copy: `go.heading`, `go.nearest`, `go.walk`, `go.accessible`,
  `go.notAccessible`, `go.accessUnknown`, `go.noStops`, `go.directions`, `go.approx`.
- `.kiro/steering/structure.md` — units are canonical **miles** in `lib/`, degrees only at the
  MBTA boundary (`milesToMbtaDegrees`, ~0.7 mi ≈ 0.01°); every empty/error state must be explicit;
  the ♿ accessible-stop icon must carry screen-reader text and never be a bare icon.
- `.kiro/steering/safety.md` — ≤ 8th-grade copy, verbatim disclaimer, no stored health data.
- `KIRO_LOG.md` (live MBTA probe, 2026-10-24) — a real `/stops` call near Mass General returned a
  **161 KB** JSON:API body of **261 stops**; the same station name recurred dozens of times across
  entrances, station nodes and boarding areas (`location_type` 0–4); coordinates live in
  `attributes.latitude` / `attributes.longitude`; `wheelchair_boarding` appeared only as **1**
  (243 stops) and **2** (18 stops) in that sample, with **0** and missing values unseen but still
  possible.

Terminology used below:
- **Site** — a `Site` with `lat` / `lon` the person is trying to reach.
- **Raw stop** — one JSON:API object from MBTA `/stops`, including entrances, boarding areas, and
  generic nodes, not only parent stations.
- **Stop (shaped)** — a `Stop` as defined in `lib/types.ts`, after filtering, de-duplication, and
  distance computation.
- **Radius** — the walking search distance in miles that bounds "nearby transit".

> Note (existing-code gaps). The code visible to this spec renders stops but does not fetch or
> shape them from MBTA. Every requirement that concerns calling MBTA, converting miles to degrees,
> filtering by `location_type`, de-duplicating by name, limiting the page size, or reading
> `wheelchair_boarding` describes behavior that is **not implemented today** — the `/api/trials/[nct]`
> route that would own it does not exist in this view. Those requirements are marked **(known gap)**
> and describe the target behavior for whoever builds that route. The requirements that concern
> rendering the already-shaped `Stop[]`, the three-nearest slice, the accessibility icon text, and
> the transit link describe behavior that `components/GettingThere.tsx`, `LineChip.tsx`, and
> `lib/geo.ts` **already implement today**. One further gap is called out at Requirement 6: today
> the only directions link is a transit link; no driving-directions URL builder exists.

---

## Requirement 1 — Query MBTA for stops near a site (known gap)

**User story:** As a person looking at a trial site, I want the app to find the public-transit
stops near that exact location, so that I can see realistic ways to get there without a car.

#### Acceptance Criteria

1. WHEN stops are needed for a site, THEN the system SHALL call the MBTA V3 `/stops` endpoint using
   the site's latitude and longitude as `filter[latitude]` and `filter[longitude]`.
2. WHEN the system builds the MBTA request, THEN it SHALL convert the radius from miles to degrees
   at the request boundary (approximately 0.7 mi ≈ 0.01°) for `filter[radius]`, keeping `lib/`
   values in miles per structure.md.
3. WHEN the system builds the MBTA request, THEN it SHALL request only the relevant route types
   (light rail, subway, commuter rail, bus — `route_type` 0,1,2,3) so bus and rail stops are
   included and other modes are excluded.
4. WHEN the MBTA response is received, THEN the system SHALL read each stop's coordinates from the
   JSON:API `attributes.latitude` / `attributes.longitude` fields (not a nested `geoPoint`).
5. IF a configured MBTA API key is available, THEN the system SHALL send it; the feature SHALL also
   function without a key for the demo.

## Requirement 2 — Limit the response page size (known gap)

**User story:** As a developer keeping the demo fast, I want the MBTA request bounded in size, so
that a single site lookup never pulls a very large payload.

#### Acceptance Criteria

1. WHEN the system calls MBTA `/stops`, THEN it SHALL constrain the response size (for example via
   the API's page-size limit) rather than accepting an unbounded list, given a real probe returned
   about 161 KB and 261 raw stops for one location.
2. WHEN the system selects stops to display, THEN it SHALL present at most the three nearest stops
   (matching the current `GettingThere` slice), regardless of how many raw stops were returned.
3. WHEN more stops are returned than are shown, THEN the system SHALL discard the rest rather than
   render a long list.

## Requirement 3 — Filter raw stops by location type (known gap)

**User story:** As a person reading the stop list, I want one entry per real station, not its
entrances and platforms, so that the list is short and understandable.

#### Acceptance Criteria

1. WHEN the MBTA response contains raw stops of differing `location_type` (0 stop/platform,
   1 station, 2 entrance/exit, 3 generic node, 4 boarding area), THEN the system SHALL filter to
   the stop-level entries it will show and SHALL exclude entrances, generic nodes, and boarding
   areas from the displayed list.
2. WHEN a raw stop has a parent station, THEN the system SHALL represent it by the station (for
   example the parent-station id such as `place-...`) rather than by the child entrance or platform.
3. WHEN filtering removes raw stops, THEN the system SHALL still compute distances and selection
   from the stop-level entries that remain, so the three nearest are real stations.

## Requirement 4 — De-duplicate stops by name (known gap)

**User story:** As a person reading the stop list, I want each station to appear once, so that one
station is not listed dozens of times.

#### Acceptance Criteria

1. WHEN multiple raw stops share the same station name (the live probe showed one name recurring
   dozens of times), THEN the system SHALL collapse them into a single shaped `Stop`.
2. WHEN raw stops are collapsed into one `Stop`, THEN the system SHALL merge the lines they serve
   into that stop's `lines` without duplicate lines.
3. WHEN a station is represented by one shaped `Stop`, THEN its `walkMi` SHALL be the distance from
   the site to the station (for example the nearest representative point), computed in miles via
   `haversineMi`.
4. WHEN de-duplication is complete, THEN the shaped list SHALL contain no two entries with the same
   station name.

## Requirement 5 — Render the nearest stops (grounded in GettingThere.tsx)

**User story:** As a person without a car, I want to see the closest stops with their lines,
accessibility, and how far I would walk, so that I can judge whether transit works for me.

#### Acceptance Criteria

1. WHEN one or more shaped stops are available, THEN the system SHALL sort them by `walkMi`
   ascending and SHALL show the three nearest.
2. WHEN a stop is shown, THEN the system SHALL show its `name`, its lines as `LineChip`s, and the
   walking distance rendered by `formatMiles` (`"< 0.1"` below a tenth of a mile, one decimal below
   ten miles, a whole number at ten or more) using the `go.walk` copy.
3. WHEN a stop has no lines, THEN the system SHALL omit the line row for that stop rather than
   render an empty line container.
4. WHEN a line's colour is not a valid 6-digit hex, THEN the `LineChip` SHALL fall back to the
   neutral swatch colour and SHALL keep the swatch `aria-hidden`.
5. WHEN the site's `locationPrecision` is not `"facility"`, THEN the system SHALL show the
   `go.approx` note that the stops are near the area, not the exact building.

## Requirement 6 — Directions links: transit, and driving when no transit

**User story:** As a person deciding how to travel, I want a transit directions link when stops
exist and a driving directions link when none do, so that I always have a usable way to get there.

> Note (existing-code gap): today `lib/geo.ts` exposes only `transitDirectionsUrl`, and
> `GettingThere.tsx` always renders that single transit link — there is no driving-directions URL
> builder and the empty-state copy (`go.noStops`) points at the same transit button. Criterion 3
> describes target behavior (a driving link in the no-transit case) that is **not implemented
> today** and implies an additive driving-directions URL builder and an extra link in the empty
> state, per structure.md's "no transit → still show a driving directions link" rule.

#### Acceptance Criteria

1. WHEN the view is shown, THEN the system SHALL render a Google Maps transit directions link built
   from the site's coordinates (and the person's origin when known) via `transitDirectionsUrl`,
   using `travelmode=transit`, and SHALL open it in a new tab with `rel="noopener noreferrer"`.
2. WHEN the transit link is rendered, THEN it SHALL use the `go.directions` copy and SHALL be a
   tap target at least 44×44 px (structure.md accessibility).
3. WHEN no stop is within the radius (the shaped list is empty), THEN the system SHALL tell the
   person there is no nearby transit AND SHALL offer a **driving** directions link, not only a
   transit link (known gap: driving link not implemented today).
4. WHEN the person's origin is unknown, THEN the system SHALL still build a valid directions link
   from the destination alone (origin omitted), as `transitDirectionsUrl` does today.

## Requirement 7 — Wheelchair-boarding status and unknown state (grounded in types + structure.md)

**User story:** As a person who uses a wheelchair, I want to know whether each stop is accessible,
and to be told plainly when that is unknown, so that I am never misled by a missing value.

#### Acceptance Criteria

1. WHEN a stop's `wheelchair_boarding` is `1`, THEN the system SHALL set `wheelchair` to `true` and
   SHALL show the accessible state with the ♿ icon and the `go.accessible` text.
2. WHEN a stop's `wheelchair_boarding` is `2`, THEN the system SHALL set `wheelchair` to `false`
   and SHALL show the `go.notAccessible` text.
3. WHEN a stop's `wheelchair_boarding` is `0` OR the field is missing, THEN the system SHALL set
   `wheelchair` to `null` and SHALL show the `go.accessUnknown` text — it SHALL NOT imply the stop
   is accessible or inaccessible. (The live probe saw only 1 and 2, but 0 and missing must still be
   handled.)
4. WHEN the ♿ accessible icon is shown, THEN the system SHALL provide equivalent screen-reader
   text and SHALL NOT present a bare icon (structure.md): today the icon is `aria-hidden` and the
   accessible/not-accessible/unknown meaning is carried by adjacent visible text.
5. WHEN accessibility status is conveyed, THEN the system SHALL NOT rely on colour alone to
   distinguish accessible, not-accessible, and unknown.

## Requirement 8 — No-transit and error states are explicit (structure.md empty/error states)

**User story:** As a person whose nearest site has no stops or whose lookup fails, I want a plain
message and a fallback, so that I am never left with a blank or broken panel.

#### Acceptance Criteria

1. WHEN the shaped stop list is empty, THEN the system SHALL show a plain-language "no nearby
   transit" message instead of an empty list, AND SHALL still show a directions link (driving per
   Requirement 6.3).
2. IF the MBTA request fails, times out, or is rate-limited, THEN the system SHALL degrade to the
   no-stops presentation (message plus a directions link) rather than throwing or blocking the
   trial view.
3. WHEN stop data is malformed (missing name or non-finite distance), THEN the system SHALL drop
   that entry during shaping (as `toDetail` does today) rather than render a broken row.
4. WHILE stops are loading, THEN the system SHALL show an accessible loading state with `aria-busy`
   and SHALL NOT show a result.

## Requirement 9 — Plain language and privacy (safety.md §2, §3)

**User story:** As a user, I want transit copy in simple words and no tracking, so that the feature
is easy to read and carries no privacy cost.

#### Acceptance Criteria

1. All user-facing English getting-there copy (`go.*`) SHALL be at or below an 8th-grade reading
   level (safety.md §2).
2. The system SHALL send off-device only the site coordinates (and, when offered, the person's
   origin coordinates) needed to query MBTA and build the directions link, and SHALL NOT transmit
   or store the person's health answers (safety.md §3).
3. WHEN station names, line names, or contact values are shown, THEN the system SHALL preserve any
   NCT id, phone number, or email verbatim and SHALL NOT translate or reformat them (safety.md §5).
