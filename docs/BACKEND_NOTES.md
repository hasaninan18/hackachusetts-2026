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

## 6. Please export plain functions too
Right now `lib/data.ts` calls `/api/trials` over HTTP from server components. On Vercel **preview** deployments, Vercel Authentication is on by default, so that server-side fetch has no cookie → 401 → "We couldn't load studies". Production URLs are fine. The Next 16 docs also advise against fetching your own route handlers from the server. If you put the logic in `lib/server/trials.ts` as `searchTrials(q)` / `getTrialDetail(nct)` (route handlers calling them), I'll switch `lib/data.ts` to import them directly. It's a one-line change on my side. Until then, set `TRIALPATH_MOCK=1` on preview deployments.

`lib/data.ts` now validates responses: trials missing `nctId`/`title`/`nearestSite`/`distanceMi` are dropped, and missing arrays (`stops`, `contacts`, `sites`, `conditions`) become `[]`.

## 7. Small things
- `phase`: `["PHASE2"]` → `"Phase 2"`, `["PHASE1","PHASE2"]` → `"Phase 1/2"`, `NA` or missing → `null`.
- Ages: `"18 Years"`, `"6 Months"`, missing. The frontend expects years as a number or `null` (6 months → 0.5).
- `/api/simplify` must return **3–6 questions** with `ruleOutIf`. The UI treats "not sure" as never ruling out, so a question phrased backwards ends up as an "ask the team". Prompt the model for questions where a single yes/no clearly maps to one inclusion or exclusion line, and keep NCT IDs, phone numbers and emails verbatim in translations.
- `GET /api/trials/[nct]` → 404 for an unknown NCT. The UI shows a not-found page.

## 8. ⚠️ PLANNED, NOT IMPLEMENTED: `GET /api/doctors` for the Doctors & clinics tab
> **Status (2026-10-24):** plan only. Nothing is built, and it's not part of the current submission scope. Frontend contract draft: FRONTEND_PLAN.md §17.

**NPI Registry (specialists)**
`https://npiregistry.cms.hhs.gov/api/?version=2.1&taxonomy_description=Endocrinology&postal_code=02124&limit=200`
- Free and needs no key. Verified on 2026-10-24.
- **Quirk:** `postal_code` and `city` also match *mailing* addresses. A 02124 search returned a Miami practice. Keep only `addresses[]` entries with `address_purpose === "LOCATION"` and `state === "MA"`.
- **Coverage:** exact-ZIP searches return very few results (2 for 02124 endocrinology). Search by `state=MA` + `city`, or by several nearby ZIPs, then compute distance yourself.
- **No coordinates:** use the practice ZIP's centroid from `lib/ma-zips.json`, mark `locationPrecision: "zip"`, and say "about" in the UI.
- Use `taxonomies[]` with `primary: true` for the specialty text. Map the condition to `taxonomy_description` with a small fixed table (diabetes → Endocrinology; asthma → Pulmonary Disease / Allergy & Immunology; breast cancer → Hematology & Oncology; …), falling back to Family Medicine / Internal Medicine. Never let AI pick the specialty.
- It returns nothing about new patients, insurance or languages spoken. Don't imply any of them.

**HRSA health centers**
Use HRSA's health-center service-delivery sites dataset on data.hrsa.gov. **Access method (API vs. bundled CSV snapshot) not yet verified.** A small bundled Massachusetts snapshot is fine for the demo if it's dated and cites its source.

**Rules**
- Inputs are only `cond`, `lat`, `lon`, `radius`. Never accept or log quick-check answers.
- Sort by distance only.
- Cache upstream for 10 minutes like trial search.
- Reuse `nearestStops()` from `lib/mbta.ts` per provider, capped (e.g. the first 10) to stay inside MBTA rate limits.
