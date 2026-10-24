# Notes for the backend (from building the frontend), checked live on 2026-10-24
The frontend talks to the routes only through `lib/types.ts`. The mocks in `lib/mock/data.ts` show the exact shapes the UI expects.

## 1. ClinicalTrials.gov `geoPoint` is the city centroid, not the hospital ⚠️
Every Boston site comes back as `42.35843,-71.05977` (MGH, Brigham, everything). Nearest-stop lookups from that point return **Government Center** for every Boston trial, which is wrong for the demo.
- Brigham and Women's real location `42.3359,-71.1065` → Brigham Circle (♿) / Fenwood Road (**not** ♿)
- MGH real location `42.3626,-71.0686` → Charles/MGH (♿) / Science Park (♿)

**Suggested fix, cheapest first:** (1) a small `FACILITY_COORDS` table for the ~15 big Boston/Cambridge hospitals, matched on facility name; (2) otherwise use the site's ZIP centroid from `lib/ma-zips.json` (Census 2024, 539 MA ZIPs); (3) otherwise keep the city point. Set `Site.locationPrecision` to `"facility" | "zip" | "city"`; the UI shows an "approximate location" note when it isn't `"facility"`.

## 2. Filter sites by their own status
`filter.overallStatus=RECRUITING` is the *trial's* status. Individual sites can still be `NOT_YET_RECRUITING` (e.g. NCT07415954, Brigham site). Keep only `locations[].status === "RECRUITING"` and `state === "Massachusetts"`.

## 3. MBTA `/stops` returns platforms, one per direction
A radius query returns `70249` and `70250` (both "Brigham Circle"). Dedupe by parent station: add `include=parent_station`, or query with `filter[location_type]=1` for rail stations (buses have no parent). `wheelchair_boarding`: 1 = accessible, 2 = not, 0 = unknown → `true | false | null`.

## 4. Lines need a second call
`include=route` doesn't work on the stops list. Use `GET /routes?filter[stop]=place-brmnl` → `long_name` + `color` (no `#`, add it). The frontend expects `Stop.lines = [{ name: "Green Line E", color: "#00843D" }]`.

## 5. Contact data is messy
A central contact "name" can be a sentence: `"Trial questions or participation questions: 1-877-CTLILLY (1-877-285-4559) or"`. Prefer site-level contacts with a phone or email, drop `PRINCIPAL_INVESTIGATOR` entries that have neither, and pass phone strings through untouched (the UI builds `tel:` links with `lib/phone.ts`).

## 6. Small things
- `phase`: `["PHASE2"]` → `"Phase 2"`, `["PHASE1","PHASE2"]` → `"Phase 1/2"`, `NA` or missing → `null`.
- Ages: `"18 Years"`, `"6 Months"`, missing. The frontend expects years as a number or `null` (6 months → 0.5).
- `/api/simplify` must return **3–6 questions** with `ruleOutIf`. The UI treats "not sure" as never ruling out, so a question phrased backwards ends up as an "ask the team". Prompt the model for questions where a single yes/no clearly maps to one inclusion or exclusion line, and keep NCT IDs, phone numbers and emails verbatim in translations.
- `GET /api/trials/[nct]` → 404 for an unknown NCT. The UI shows a not-found page.
