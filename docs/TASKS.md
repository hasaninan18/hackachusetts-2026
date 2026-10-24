# TrialPath MA — Start Here (coding is live)

## Current assignments — October 24 live-browser review

This section supersedes historical status and sequencing below. Follow current main as the integration baseline. App changes run through Kiro; retain accurate attribution and execution evidence.

- **Completed and merged:** PR #3 search/detail backend plus Faulkner/cache fixes; PR #6 frontend and complete UI dictionaries; PR #11 MBTA nearby stops. Combined main passed 178 tests, typecheck, and lint (0 errors). The old five dictionary failures are resolved on main.
- **Hasan — MAIN REMAINING RISK:** finish `feat/simplify` through the active Kiro agent. Live Bedrock authentication succeeded; no credential setup redo is needed. Before merge, align client timeout and bounded backend request budget, enforce translation preservation of question IDs/order/ruleOutIf/kind, and validate original source_criterion evidence with explicit structured-age handling. Coordinate any TrialPlain timeout edit with Neil. Integrate latest main, run combined checks, then verify deployed English AND Spanish generation/checklist end to end. Current production /api/simplify returns 404; successful deployed generation remains unverified.
- **Hasan — separate backend fix:** live search at ZIP 02124/type 2 diabetes/radius 10 displayed NCT07064473 in Methuen about 31 miles away. Reproduce and enforce the advertised radius using corrected nearest-site distances, with regression coverage. Keep this agent's edits to search/backend files separate from simplify.
- **Neil — frontend:** PR #6 is already merged. Fix cautious fallback so missing/generated-criteria failure does not yield positive possible-fit wording from age/condition alone; own lib/quickCheck.ts and related UI changes, coordinate tests with Akash. Add verified hero fixtures including NCT07043426, share alongside print, and driving fallback when no transit is available. Complete mobile/keyboard/screen-reader and fluent-speaker checks. Hold pure-age-rank refactor and reported-results expansion until after core submission. Coordinate with Hasan before editing TrialPlain timeout.
- **Akash — QA/evidence:** setup work is merged through PRs #9/#10; verify latest actual status before repeating old fixes. Ensure portable macOS copy-guard invocation, observe real save-triggered execution and capture evidence, remove any remaining MCP BOM, and incorporate DEMO_DATA prompt rules/Vietnamese protections. Own tests/** safety properties; coordinate with Neil so tests enforce the cautious missing-criteria fallback rather than locking in positive wording. Review whether PR #8 adds anything beyond merged MCP configuration. Prepare QA checklist, README/Kiro write-up, and submission evidence.
- **Browser verification completed:** desktop 1440px and mobile 390px live search → NCT07043426 → corrected BMC site → three accessible stops → contact; Spanish navigation/context reset; no horizontal overflow or uncaught JS errors; synthetic health answers caused no network requests. Missing simplify currently falls back without crashing. Re-test after fixes and simplify deployment. Route labels are currently empty; do not fabricate labels or label unknown accessibility as accessible. Actual screen-reader/native-speaker checks remain outstanding.
- **Milestones:** working complete English/Spanish hero flow by 4 PM; feature freeze 5 PM; demo video/public upload and submission materials thereafter; target SundAI submission 7:15 PM, hard deadline 8 PM. Include public repo/.kiro, live URL, video under 3 minutes, accurate Kiro write-up, Healthcare & Biotech track, and all three members.

Record completed work/evidence in KIRO_LOG.md; keep assignments here. Owners must pull latest main/docs and coordinate any shared-file changes.

## Rules of the road (avoid merge conflicts)
- **Update 11:10 (supersedes 10:55):** Neil REBUILDS the frontend in the **Kiro IDE**, spec-first, on a fresh branch `ui/kiro` from main, so the UI is clearly Kiro-built. `neil/frontend` is reference only — **do not merge it**. Order: (1) Akash merges `kiro/steering-docs` → main now; (2) Neil's first Kiro task = scaffold, pushed to main within ~15 min; (3) Hasan pulls and builds the API. Timebox: if the Kiro rebuild isn't at parity by **12:45**, fall back to `neil/frontend` + a retro-spec.
- **Folder ownership:**
  - Hasan → `app/api/**` and NEW files `lib/clinicaltrials.ts`, `lib/mbta.ts`, `lib/bedrock.ts` (reuse Neil's `lib/types.ts`, `lib/geo.ts`)
  - Neil → `app/[lang]/**` pages, `components/**`, styles, `lib/types.ts`, `lib/geo.ts`, `lib/quickCheck.ts`, `lib/i18n/**`, `lib/mock/**`
  - Tests live next to the code (`lib/foo.test.ts`), matching Neil's layout
  - Akash → `.kiro/**`, `tests/**`, `README.md`, `KIRO_LOG.md`
- Before every push: `git pull --rebase origin main`. Push small and often.
- All code is written **in Kiro**. Use specs (`.kiro/specs/`) for each feature. Never commit `.env.local` or the Bedrock key.
- Every push to `main` auto-deploys to Vercel (project `trialpath-ma`).
- Keep notes in `KIRO_LOG.md`: which Kiro feature you used and what it did for you (feeds the write-up).

---

## Hasan — scaffold + backend (paste into Kiro, in this order)

**1. Scaffold — SKIP** (Neil's Kiro rebuild does it first). Pull main once Neil's Kiro scaffold lands, then start at step 2. Adapt prompts to reuse `lib/types.ts` / `lib/geo.ts` instead of creating `haversineMiles`.

**2. Spec: trial-search backend**
> Create a spec `trial-search-api`. Build `GET /api/trials?cond=&lat=&lon=&radius=` as a Next.js route handler that calls ClinicalTrials.gov API v2 `https://clinicaltrials.gov/api/v2/studies` with `query.cond`, `filter.overallStatus=RECRUITING`, `filter.geo=distance(lat,lon,{radius}mi)`, `pageSize=50`, and a `fields` list limited to: NCTId, BriefTitle, Condition, Phase, BriefSummary, EligibilityModule, LocationFacility, LocationCity, LocationState, LocationGeoPoint, CentralContactName, CentralContactPhone, CentralContactEMail. Return a slim JSON list of trials with only Massachusetts sites, each with its nearest site and distance in miles, sorted nearest-first. Also `GET /api/trials/[nct]` returning full details for one study. Put pure functions in `lib/` — `parseAge("18 Years")`, `haversineMiles`, `nearestSite`, `slimStudy` — with unit tests and fast-check property tests. Cache upstream responses for 10 minutes. IMPORTANT: ClinicalTrials.gov gives every Boston site the same geoPoint (42.35843, -71.05977) — add `lib/facilities.ts` with the corrected hospital coordinates and name-matching rules from `docs/DEMO_DATA.md`, apply it before computing distances and MBTA stops, and default the radius to at least 5 miles.

**3. Spec: getting-there**
> Create a spec `getting-there`. Add `lib/mbta.ts` with `nearestStops(lat, lon)` calling MBTA V3 `https://api-v3.mbta.com/stops?filter[latitude]=&filter[longitude]=&filter[radius]=0.01&filter[route_type]=0,1,2,3` and returning up to 3 stops with name, route types, wheelchair_boarding (1 = accessible), and walking distance from the site. Include the result in `/api/trials/[nct]`. Also return a Google Maps transit link: `https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=transit`.

**4. Spec: simplify (Bedrock)** — after 1–3 work
> Create a spec `simplify`. Add `POST /api/simplify` with body `{nct, lang}`. It loads the study, then calls Amazon Bedrock Converse API (`@aws-sdk/client-bedrock-runtime` ConverseCommand, region from AWS_REGION = us-east-2, model from BEDROCK_MODEL_ID = `us.amazon.nova-2-lite-v1:0`, fallback BEDROCK_FALLBACK_MODEL_ID = `us.amazon.nova-pro-v1:0`; auth via AWS_BEARER_TOKEN_BEDROCK env which the SDK picks up automatically). Ask for strict JSON: `{summary: string (≤80 words, 8th-grade level), whatYouDo: string, questions: [{id, text, rulesOut: "yes"|"no"}] (3–6 yes/no questions derived from inclusion/exclusion criteria)}` in the requested language (en, es, pt, ht, zh, vi). Validate the JSON; retry once on failure. Follow ALL 15 prompt rules in `docs/DEMO_DATA.md` (one fact per question, 6th–8th grade, quoted source_criterion per question, staff_checks for non-self-knowable items, sensitive-topic rule, age question from structured fields, usted Spanish translated from the English JSON). Never output "eligible"/"qualify". Cache results in memory per (nct, lang). Pre-warm the 4–5 demo trials listed in `docs/DEMO_DATA.md`.

## Neil — frontend (REBUILD in Kiro IDE on `ui/kiro`; old `neil/frontend` = reference only)

**0. Scaffold first (push to main in ~15 min):** use Hasan's original scaffold prompt — Next.js App Router + TypeScript + Tailwind + Vitest + fast-check, `.env.example`, `lib/ components/ tests/`, `npm run build` passes.

**1. Then the UI spec** (create it in Kiro → requirements → design → tasks, and run tasks from the spec; reuse ideas from `neil/frontend` such as `[lang]` routing, MA ZIP lookup, quickCheck, i18n dictionaries):
> Create a spec `trialpath-ui`. Build three screens with Tailwind, mobile-first, WCAG AA contrast, large tap targets, keyboard accessible, and a language picker (English, Español, Português, Kreyòl Ayisyen, 中文, Tiếng Việt) in the header. (1) Home/search: condition text input, ZIP code or "Use my location" button, distance select (5/10/25 mi), Search. (2) Results: cards nearest-first with plain title, condition, phase, nearest site + town, distance, "See if it might fit". (3) Trial page: plain-language summary, "What you'd do", a "Might this fit me?" checklist of yes/no/not sure questions that ends in either "Looks like a possible fit — contact the study team" or "Some answers may rule you out — ask the study team" (never "eligible"), a "Getting there" card (nearest T stops, ♿ accessible badge, walking distance, transit directions button), the study contact, and a "Print / share summary" button. Footer on every page: "TrialPath is not medical advice. The study team decides eligibility." Use mock data in `lib/mock.ts` until `/api/trials` and `/api/simplify` are ready, then switch to the real endpoints.

## Akash — Kiro strategy, tests, story (start now)
1. **Steering (done on `kiro/steering-docs`) — fix:** update `tech.md` to Nova 2 Lite / Nova Pro, us-east-2 confirmed, Claude unavailable on Free plan; update `structure.md` so tests live next to code. Then merge to main. Original step: run Kiro's "Generate steering docs" (product/tech/structure), then add `.kiro/steering/safety.md` using Prompt A in `docs/PLAN.md`. Push right away so everyone's Kiro follows it.
2. **Hooks** (`.kiro/hooks/`):
   - On save of `lib/**/*.ts` → run `npm test`.
   - On save of `app/**/*.tsx` or `components/**` → check user-facing strings for "eligible"/"qualify" and flag text above 8th-grade reading level.
   - Manual "update docs" hook → refresh README "How we used Kiro" from `KIRO_LOG.md`.
3. **MCP:** add the fetch MCP server (`uvx mcp-server-fetch`) in Kiro's MCP config; use it to inspect ClinicalTrials.gov/MBTA responses. Optionally add the AWS Agent Toolkit (Hasan has the setup prompt from the AWS console).
4. **Property tests:** once `lib/` exists, add fast-check tests: parseAge never throws and min ≤ max; nothing user-facing contains "eligible"; translations keep NCT IDs/phones/emails unchanged.
5. **Kiro tools variety:** use Kiro CLI for test runs/scripts and Kiro Crew for a parallel task; screenshot each.
6. Start `KIRO_LOG.md` and the demo-video script (PLAN §7). Submission checklist is PLAN §8.
