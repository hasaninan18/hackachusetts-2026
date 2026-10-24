# Tasks — getting-there

Tasks the existing code already satisfies are marked `[x]` with the file that satisfies them.
Open tasks are grouped by owner per `.kiro/steering/structure.md`:
- **Hasan** owns `app/api/**` and the new API clients `lib/mbta.ts` (reuses Neil's `lib/geo.ts` /
  `lib/types.ts`).
- **Neil** owns `lib/geo.ts`, `components/**`, and `lib/i18n/**`.
- **Akash** owns `.kiro/**`, `tests/**`, `README.md`, `KIRO_LOG.md`.

Nothing in `lib/`, `app/`, or `components/` is edited by this spec — the Hasan and Neil tasks below
are the handoff. The exact drafts live in `design.md` → "Proposed change for the owner"; the
unimplemented behaviors are catalogued there as gaps **G1–G5**.

---

## Already satisfied by existing code

- [x] 1. Render the three nearest stops, sorted by walking distance
  - `components/GettingThere.tsx` — `[...stops].sort((a,b) => a.walkMi - b.walkMi).slice(0, 3)`.
  - _Requirements: 2.2, 2.3, 5.1_
- [x] 2. Show each stop's name, lines, and walking distance in miles
  - `components/GettingThere.tsx` (name, `LineChip` row, `go.walk`) + `lib/geo.ts` `formatMiles`
    (`"< 0.1"` / one decimal / rounded whole).
  - _Requirements: 5.2_
- [x] 3. Omit the line row when a stop has no lines
  - `components/GettingThere.tsx` — `stop.lines.length > 0 && (…)`.
  - _Requirements: 5.3_
- [x] 4. Line chip with an accessible colour swatch and a safe fallback colour
  - `components/LineChip.tsx` — `aria-hidden` swatch, `#7C878E` when `line.color` is not 6-digit hex.
  - _Requirements: 5.4_
- [x] 5. "Approximate location" note when the site is not a known facility
  - `components/GettingThere.tsx` — `go.approx` when `site.locationPrecision !== "facility"`.
  - _Requirements: 5.5_
- [x] 6. Wheelchair-boarding rendered as accessible / not accessible / unknown
  - `components/GettingThere.tsx` `<Access>` — `true`→`go.accessible`, `false`→`go.notAccessible`,
    `null`→`go.accessUnknown`. (The 1/2/0/missing → `boolean|null` mapping that feeds this is the
    open gap G1, task H3.)
  - _Requirements: 7.1, 7.2, 7.3 (render half)_
- [x] 7. ♿ icon has screen-reader-safe text and never stands alone (structure.md)
  - `components/GettingThere.tsx` — `♿` is `aria-hidden`; meaning carried by adjacent visible text;
    accessible/not/unknown distinguished by text, not colour alone.
  - _Requirements: 7.4, 7.5_
- [x] 8. Google Maps **transit** directions link, new tab, safe rel
  - `components/GettingThere.tsx` — `transitDirectionsUrl(site, origin)`, `target="_blank"`,
    `rel="noopener noreferrer"`, `go.directions`, `min-h-12` (≥ 44 px) + `lib/geo.ts`
    `transitDirectionsUrl` (`travelmode=transit`, origin optional).
  - _Requirements: 6.1, 6.2, 6.4_
- [x] 9. No-stops message rendered instead of an empty list
  - `components/GettingThere.tsx` — `go.noStops` when the list is empty. (Today it keeps the
    transit link; swapping that for a **driving** link is gap G4, tasks N1–N3.)
  - _Requirements: 8.1 (message half)_
- [x] 10. Malformed stop entries dropped during shaping
  - `lib/data.ts` `toDetail` — keeps only stops with a string `name` and finite `walkMi`; defaults
    `lines` to `[]`.
  - _Requirements: 8.3_
- [x] 11. Getting-there copy is ≤ 8th grade with no forbidden phrases
  - `lib/i18n/en.ts` `go.*`; enforced by the copy-guard hook (`tests/copy-guard.mjs`).
  - _Requirements: 9.1_
- [x] 12. Only coordinates leave the device; no health answers sent or stored
  - `components/GettingThere.tsx` / `lib/geo.ts` — directions links use site (+ optional origin)
    coordinates only; no health data is read or transmitted here.
  - _Requirements: 9.2_

---

## Open — Hasan (owns `app/api/**`, new `lib/mbta.ts`)

These implement the data layer (gaps **G1–G3**). Exact draft code is in `design.md` → Drafts 1–2.
Canonical unit is miles; degrees only at the MBTA request boundary.

- [ ] H1. Create `lib/mbta.ts` with `nearestStops(lat, lon, radiusMi, limit=3)`
  - Calls MBTA V3 `/stops` with `filter[latitude]`, `filter[longitude]`,
    `filter[radius]`=`milesToMbtaDegrees(radiusMi)`, `filter[route_type]=0,1,2,3`, `include=route`,
    `page[limit]`. Reads coordinates from `attributes.latitude`/`attributes.longitude`. Sends
    `MBTA_API_KEY` when set; works without a key.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
- [ ] H2. Filter raw stops by `location_type` and de-duplicate by name (pure `shapeStops`)
  - Keep `location_type` 0/1 (and undefined), drop 2/3/4; prefer the parent-station id; collapse
    duplicate names into one `Stop`, merge lines without duplicates, keep the nearest-point
    `walkMi` via `haversineMi`.
  - _Requirements: 2.1 (via page limit), 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4_
- [ ] H3. Map `wheelchair_boarding` to `boolean | null` (pure `wheelchairFrom`)
  - 1 → `true`, 2 → `false`, **0 and missing → `null`** (never guess); feeds the existing
    `<Access>` unknown state. The probe saw only 1 and 2; 0/missing must still be handled.
  - _Requirements: 7.1, 7.2, 7.3 (mapping half)_
- [ ] H4. Bound the MBTA payload
  - Set `page[limit]` so one site (probe: ~161 KB / 261 raw stops) does not pull an unbounded list;
    return only the nearest `limit` (3) after shaping.
  - _Requirements: 2.1_
- [ ] H5. Degrade MBTA failures to an empty `stops` list
  - On non-OK status, timeout, network error, or rate-limit, `nearestStops` returns `[]` so the UI
    shows the no-transit state; it never throws out of the function.
  - _Requirements: 8.2_
- [ ] H6. Include `stops` in `GET /api/trials/[nct]`
  - Call `nearestStops(site.lat, site.lon, …)` on the facility-corrected site and return `stops` in
    the detail payload; rely on `lib/data.ts` `toDetail` to defend the shape. An MBTA outage must
    not break the trial page.
  - _Requirements: 1.1, 8.2, 8.4_
- [ ] H7. Co-located unit tests for the pure functions
  - File: `lib/mbta.test.ts` — `shapeStops` (location_type filtering, name de-dup, line merge,
    nearest `walkMi`), `milesToMbtaDegrees`, and `wheelchairFrom` (1/2/0/missing).
  - _Requirements: 2.1, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 7.1, 7.2, 7.3_

## Open — Neil (owns `lib/geo.ts`, `components/**`, `lib/i18n/**`)

These implement the driving-link fallback (gaps **G4–G5**). Exact draft code is in `design.md` →
Drafts 3–5.

- [ ] N1. Add `drivingDirectionsUrl(dest, origin?)` to `lib/geo.ts`
  - Mirror of `transitDirectionsUrl` but `travelmode=driving`; origin optional.
  - _Requirements: 6.3_
- [ ] N2. Show the driving link in the no-transit state in `components/GettingThere.tsx`
  - When the shaped list is empty, render the **driving** link (not the transit link) alongside the
    `go.noStops` message; keep `target="_blank"`, `rel="noopener noreferrer"`, and the ≥ 44 px tap
    target.
  - _Requirements: 6.3, 8.1_
- [ ] N3. Add the i18n key `go.drivingDirections` (≤ 8th grade, no forbidden phrases)
  - File: `lib/i18n/en.ts`. Add the mirrored key to the other dictionaries before each language
    ships; run copy-guard on the new string.
  - _Requirements: 6.3, 9.1_

## Open — Akash (owns `.kiro/**`, `tests/**`, `KIRO_LOG.md`)

- [x] A1. Requirements + design authored, grounded in the code and the live MBTA probe
  - Files: `.kiro/specs/getting-there/requirements.md`, `.kiro/specs/getting-there/design.md`
    (field shapes, gaps G1–G5, owner drafts).
  - _Requirements: all_
- [ ] A2. Property tests for the new boundary helpers (land with Hasan's PR)
  - File: `tests/` (cross-cutting) — `milesToMbtaDegrees` monotonic & non-negative (structure.md);
    `wheelchairFrom` returns `true` only for 1, `false` only for 2, and `null` for everything else
    (incl. 0 and undefined); `shapeStops` never throws on arbitrary/empty JSON:API input.
  - _Requirements: 1.2, 2.1, 7.1, 7.2, 7.3_
- [ ] A3. Log the gaps + decision + ownership in `KIRO_LOG.md`
  - File: `KIRO_LOG.md` (Specs section) — note the getting-there spec, the five gaps (MBTA fetch /
    location_type filter / name de-dup / page limit / driving link), and that the drafts are handed
    to Hasan (`lib/mbta.ts`, `app/api/**`) and Neil (`lib/geo.ts`, `components/**`, `lib/i18n/**`).
  - _Requirements: all_
- [ ] A4. After the owner PRs merge, record what shipped
  - File: `KIRO_LOG.md` — note the stops pipeline and driving-link fallback landed, only what was
    observed (and confirm 0/missing wheelchair values render as "access unknown").
  - _Requirements: 7.3, 8.2_
