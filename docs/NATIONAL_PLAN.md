# TrialPath national expansion plan

Goal: take TrialPath from Massachusetts-only to every recruiting trial site in the US,
without weakening the safety rules in `.kiro/steering/safety.md` (never claim eligibility,
plain language, privacy, verbatim identifiers).

Status of each piece is tracked in [Implementation status](#implementation-status) at the end.

## 1. Size of the problem

Live ClinicalTrials.gov counts, 2026-11-01 (`filter.overallStatus=RECRUITING`, study level):

| Area | Recruiting trials |
|---|---|
| **United States** | **22,047** |
| California | 5,515 |
| Texas | 4,894 |
| New York | 4,496 |
| Florida | 3,936 |
| Ohio / Pennsylvania / Massachusetts | ~3,150–3,180 each |
| Washington, Illinois, North Carolina, Maryland | 2,500–2,800 |

- State counts are per study, and one study can recruit in many states, so they add up to more than 22,047.
- 5,080 US trials (23%) mention "English" in their eligibility text. This is a keyword count, not
  the MA method, so the English-only flag matters even more nationally.
- Multi-word states need `query.locn=AREA[LocationState]"New York"`. A plain `query.locn=New York`
  undercounts badly (it returned 739 instead of 4,496).

## 2. Target architecture

Today every search calls ClinicalTrials.gov live and keeps a 10-minute in-memory cache. Nationally,
TrialPath serves search from its own database, refreshed nightly.

```
Nightly jobs (cron)                          Request time (Vercel)
───────────────────                          ─────────────────────
ClinicalTrials.gov v2 ──► trials, sites ─┐   ZIP / geolocation
GTFS feeds (Mobility DB) ──► stops ──────┤──► Postgres + PostGIS ──► search API ──► UI
CMS + NPPES ──► facility coordinate fix ─┤   (nearest sites, nearest stops,
Bedrock ──► summaries / translations ────┤    reviewed content)
Review tool ──► approvals ───────────────┘
```

Why:
- ClinicalTrials.gov is rate-limited, and calling it per user request gets slow at national traffic.
- The full US recruiting set is about 23 requests at `pageSize=1000`.
- Nightly updates only fetch what changed:
  `filter.advanced=AREA[LastUpdatePostDate]RANGE[<yesterday>,MAX]`.
- Distance gets checked per site in SQL (`ST_DWithin`). That replaces the current workaround where
  `filter.geo` matches whole studies and `withinRadius` filters afterwards.

### Code changes

| Where | What's MA-only today | National replacement |
|---|---|---|
| `lib/clinicaltrials.ts` | `MASSACHUSETTS` site filter | `lib/region.ts`: a `Region` set to `ma`, `new-england` or `us` |
| `lib/geo.ts` `isMaZip` + `lib/ma-zips.json` | ZIP check and ZIP table for MA only | National Census ZCTA table, split by 3-digit prefix under `public/zcta/` and loaded on demand |
| `lib/facilities.ts` `isBostonCentroid` | Fixes only Boston's city-center pin | Data-driven: find any point shared by several distinct facilities in one city, then fix it from CMS / NPPES |
| `lib/mbta.ts` | MBTA only | `TransitProvider` interface: MBTA plus a GTFS stops table, with the Google Maps link as fallback |
| `lib/cache.ts` | Per-instance memory cache | Mostly replaced by the database |
| `lib/i18n/*` | Copy says "Massachusetts", "MBTA", "the T" | Region-aware strings |

## 3. Data sources and APIs

| Need | Source | Cost | Notes |
|---|---|---|---|
| Trials | ClinicalTrials.gov API v2 | Free | Nightly full pull plus a daily update of changes |
| Bulk analysis | AACT (CTTI's Postgres copy of ClinicalTrials.gov) | Free | English-only scan, stats, backfills |
| Cancer eligibility | NCI Clinical Trials Search API | Free key | Structured biomarker and disease-stage fields, a safer base for yes/no questions |
| ZIP → lat/lon | Census ZCTA Gazetteer | Free | ~33k ZIP areas, refreshed yearly |
| ZIP → state | Census ZCTA-to-county relationship file | Free | First two digits of the county code give the state |
| Address → lat/lon | Census Geocoder | Free | Nightly job only, never per request |
| Facility fix | CMS Hospital General Information, NPPES NPI registry (organizations) | Free | ClinicalTrials.gov sites have **no street address**, only name, city, state and ZIP. Match on name; if there's no match, label the location "approximate". |
| Transit stops | Mobility Database GTFS catalog → import stops into PostGIS | Free | No per-request vendor cost. Includes `wheelchair_boarding`, which is often missing: show "unknown", never "no". |
| Transit (stopgap) | Transitland API | Check current terms | Faster start while the GTFS import gets built |
| Directions | Google Maps deep link (already in `lib/geo.ts`) | Free, no key | Fallback everywhere |
| Language need | Census ACS API, table C16001 | Free key | Picks which languages each region shows first |
| Health centers | HRSA Data Warehouse site file | Free | Optional "low-cost care near you" link |
| Summaries / translation | AWS Bedrock (already used) | Per token | Generate once per trial, keyed by the criteria hash; regenerate only when the text changes |

**Bedrock cost:** run 100 random US trials through the pipeline, multiply the real cost by 220
(to cover 22k trials), then by the number of languages. After that, only trials that change cost
anything.

## 4. Keeping content safe at 22,000 trials

Coordinators can't hand-review 22k trials, so every trial shows its level of trust:

| Level | What the user sees | Source |
|---|---|---|
| 0: Official | Original ClinicalTrials.gov text plus contacts | Every trial |
| 1: Plain-language summary | AI summary marked "not reviewed by the study team" | Every trial, automatic |
| 2: Auto-checked questions | Yes/no questions only for criteria with an exact rule match (age, sex, healthy volunteers). Everything else is blocked by default, as `lib/simplify-mappings.ts` already does. | Many trials, automatic |
| 3: Study-reviewed | Full quick-check and translations, with a "Reviewed by [site]" badge | Review tool |

How review scales:
- **Coordinators prove who they are with the email already on ClinicalTrials.gov.** The tool sends
  a magic link to the contact address listed for that trial, so no manual vetting or passwords.
- **Sponsors review once, every site benefits.** One sponsor approving a trial covers all of its
  US sites. That's the scalable path and the product sponsors would pay for.
- **Site networks:** academic medical centers, NCI cancer centers and CROs each run hundreds of trials.

## 5. Languages

- Today: en, es, ht, pt, vi, zh.
- Likely next, based on national data: Tagalog, Arabic, Korean, Russian. Confirm the order with
  ACS C16001 per region.
- Show the languages each area needs first, e.g. Haitian Creole in Boston and Miami, Vietnamese in
  Houston and Orange County.
- Native-speaker review works like trial review: reviewed translations get a badge, unreviewed ones a label.

## 6. Rollout phases

Rough estimates for three students working part time.

| Phase | Scope | Exit criteria |
|---|---|---|
| A. Platform (~3–4 wks) | Postgres + PostGIS, nightly import, `Region` / `TransitProvider` refactor, national ZIP table, facility fix | MA results match today's site; all tests pass |
| B. New England (~2 wks) | CT, RI, NH, VT, ME, using RIPTA, CTtransit and other GTFS feeds | 50-site spot-check for correct pins, stops and contacts |
| C. Top metros (~4 wks) | NYC, LA, Chicago, Houston, Philadelphia, Miami, DC/Baltimore, Seattle, Atlanta, Bay Area | Same 50-site spot-check per metro; search stays fast |
| D. National (~2 wks) | All states; driving directions where there's no transit | Every US ZIP returns results or a clear "none nearby" |
| E. Scale review (ongoing) | Multi-org review tool, sponsor accounts, cancer-center outreach, translation review | Target counts of Level-3 trials and reviewed languages |

## 7. Legal and product rules at national scale

- **Keep collecting nothing:** no accounts, quick-check answers stay in the browser, nothing logged.
  That keeps TrialPath clear of the FTC Health Breach Notification Rule and state consumer-health
  laws (Washington My Health My Data Act, Nevada, Connecticut).
- **ZIP lookup leaks only the 3-digit prefix:** the browser fetches `public/zcta/<prefix>.json`, not
  the full ZIP.
- **Name:** search the USPTO for "TrialPath" before national branding, and move off
  `trialpath-ma.vercel.app`.
- **Accessibility:** keep meeting WCAG 2.2 AA. Hospitals and sponsors will ask.
- **Wording:** "might fit, ask the study team", never "you qualify".

## 8. Workstreams

- **Data platform:** database, nightly imports, ZIP and facility data, transit import.
- **Content safety:** trust levels, review tool, coordinator email check, sponsor accounts.
- **Product and partners:** trust-label and region UI, language choices, sponsor and site outreach.

## 9. Numbers to track

- Share of US trials at each trust level.
- How many trials a person finds within reach (distance and transit), by ZIP.
- Accuracy of site pins on spot-checks.
- How many people reach trials whose eligibility doesn't require English.
- How many sponsors and sites are reviewing.

## Findings from the first national snapshot (2026-11-01)

From `npm run snapshot:us` and `npm run db:load -- --compare`:

- **21,826 trials** have at least one recruiting US site, across **136,398 recruiting US sites**.
  Only 3 sites had no usable location.
- **Most site pins are city centers, not buildings.** 3,128 of 3,138 US cities have exactly one
  point for every site in them; 93.6% of sites sit on a point shared by 3+ facilities. Boston
  only differs because of `FACILITY_OVERRIDES`. Consequences:
  - Distances nationally are "to the city center", not "to the hospital".
  - Nearest-stop transit would be "nearest stop to city hall". **Facility matching must ship
    before national transit.**
  - The ingest now labels these sites `locationPrecision: "city"` (`markSharedPointsAsCity`), so
    the UI can say "approximate".
- **English:** 3,766 trials (17.3%) require English with no other language, and 615 more require
  English or another named language (heuristic in `lib/ingest/quality.ts`; MA was 16%).
- **MA is 2,780 trials at site level.** That's trials with a *site* in MA that is itself
  recruiting; the 3,146 in the README is the study-level count.
- **The live search was silently capped at 50 studies** (`pageSize=50` in `buildSearchUrl`).
  Houston, breast cancer, 10 mi: live showed 44, the database finds 175. Fixed on
  `fix/live-search-cap`: the live path now follows `nextPageToken` (1000 per page, at most 4
  pages, one 10 s deadline) and returns the nearest 200, like the database path.
- **Database search vs live:** the database found every live result except 1 per dense probe.
  Both misses were synonym gaps ("breast cancer" vs "Breast Carcinoma"; "Type1diabetes" written
  as one word). Fix: import MeSH entry terms (NLM), not a hand-made synonym list.
- Speed: full pull 60–70 s; local load 20 s; database search 20–340 ms.

## How to run the national pipeline locally

No Docker or database account needed. PGlite runs Postgres + PostGIS in-process.

```
npm run build:zcta -- <2024_Gaz_zcta_national.txt> <tab20_zcta520_county20_natl.txt>   # only when Census data changes
npm run snapshot:us                    # → data/snapshot/us-<date>.ndjson + .report.json
npm run db:load -- --compare           # → data/pglite, then compares with live search
```

To try the whole-US site filter in the app, build with `NEXT_PUBLIC_TRIALPATH_REGION=us`
(or `new-england`). Unset, it stays `ma`. UI copy still says "Massachusetts" and "MBTA"
until region-aware copy lands.

To have the app search the local database instead of ClinicalTrials.gov:

```
# PowerShell
$env:NEXT_PUBLIC_TRIALPATH_REGION="us"; $env:TRIALPATH_PGLITE_DIR="data/pglite"; npx next dev -p 3000
```

- `/api/trials` uses the database only when `TRIALPATH_PGLITE_DIR` is set. It falls back to the
  live ClinicalTrials.gov path if the database fails, and still filters sites to the build's region.
- PGlite allows one process at a time: stop the dev server before running `npm run db:load`.
- Houston, breast cancer, 10 mi: 175 results from the database vs 44 from the live path.

## Implementation status

Phase A, branch `neil/national-expansion`:

| Step | Status |
|---|---|
| Plan written (this file) | Done |
| `lib/region.ts` + region-aware site filter (default stays `ma`) | Done |
| National ZIP table (`public/zcta/`, 33,774 ZIP areas) + `lib/zip.ts`, used by the search form | Done (checked in the browser) |
| US snapshot job + data-quality report (`scripts/snapshot-us.ts`, `lib/ingest/`) | Done |
| Postgres + PostGIS schema (`db/schema.sql`) + loader + search (`lib/db/trials.ts`) | Done, tested on PGlite |
| Hosted database (Neon or Supabase) + `pg` client + nightly cron route | Not started; needs a team account |
| `/api/trials` searches the database when one is configured (local PGlite via `TRIALPATH_PGLITE_DIR`), with live fallback | Done (checked in the browser) |
| Hosted Postgres client (`DATABASE_URL`) for the same path | Not started; waits on the hosted database choice |
| `/api/trials/[nct]` detail from the database (consistent "city" pin labels; no live call) | Not started |
| MeSH entry terms for condition synonyms | Not started |
| Facility matching against CMS / NPPES (fix city-center pins) | Not started; **blocks national transit** |
| `TransitProvider` + GTFS stops import | Not started |
| Region-aware copy in `lib/i18n/*` (all 6 languages) | Not started |
| Bedrock cost run on 100 US trials | Not started |

Known gaps:
- On the live per-request path, `correctCoordinates` still places a site with no geoPoint at
  Boston's center. That's harmless for MA, but don't ship `us` on the live path. The database path
  uses the ZIP centroid instead.
- US territories (PR, GU, VI, AS, MP) are outside every region for now.
