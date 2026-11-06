# TrialPath MA — Start Here (coding is live)

## Current assignments — core first; optional directory last

This section supersedes historical prompts/status below. Refresh from latest `origin/main` before acting; existing worktrees do not update automatically. Preserve uncommitted work and coordinate shared files. App implementation runs through Kiro with accurate evidence; these coordination docs do not prove Kiro execution.

| Owner | Core work first | Optional directory only after that work is safe |
|---|---|---|
| **Hasan** | Simplify PR #18 is merged (`228a326`, October 24 ~3:20 PM); independent integration review passed 260 tests, typecheck/lint and production build. **TOP BLOCKER: deployed EN/ES HTTP 200 is not semantic acceptance.** Review found a type-2-diabetes question with reversed rule-out polarity and a type-1 exclusion citation, an unrelated age citation, and a staff-judged CCM item asked directly. Resolve source/question meaning, polarity and staff-check routing; re-verify actual English/Spanish generated output before describing simplify as ready. Production was rolled back to the prior deployment without simplify (`dpl_9aukErpweSPJAsy8rzwEhxmsXZjW`); PR #18 remains in main. Do not merge even docs-only changes to main until the semantic fix or explicit deployment gating is resolved: main auto-deploy could republish the issue. Fix the live radius bug: a 10-mile search included NCT07064473 at ~31 miles. Keep existing core and optional agents in separate worktrees. | Separate Kiro backend agent: NPI-only MA practice-location filtering, fixed specialty/primary-care fallback, bounded queries/cache, approximate ZIP distance, radius/ranking and focused tests. No HRSA or provider transit. |
| **Neil** | Finish PR #16 blockers first: failed/unavailable generated criteria must not yield positive fit wording from age/condition alone, even with nonempty raw criteria; the mock “type 2 diabetes” query must find hero NCT07043426. Retain regression tests, then browser-check fixes/share/driving/origin flow and request re-review. Hold optional PR #15 age/rank refactor and reported-results expansion. | Separate Kiro frontend agent: agreed shared contract, tab/list/trial link, states and EN/ES provider copy. Preserve the other four trial languages with an explicit safe directory fallback. No concurrent edits to TrialPlain, quick-check or contract files. |
| **Akash** | Finalize safety-test coordination with Neil, current hook/MCP evidence, README/Kiro write-up consistency, QA checklist and submission materials. Refresh actual main status before repeating older fixes. Record only observed Kiro/CLI/Crew behavior. | Review contract/data fidelity, cross-cutting safety/privacy tests and EN/ES/browser/accessibility evidence. No health answers in requests, no doctor endorsement/affiliation/referral guarantees. |

**Code merged (not a statement of current production):** PR #3 search/detail backend plus Faulkner/cache fixes; PR #6 frontend and complete UI dictionaries; PR #11 MBTA; PR #18 simplify. The old five dictionary failures are resolved on integrated main. A successful Bedrock call or HTTP 200 is distinct from clinical/source/polarity acceptance; the observed simplify semantic errors block optional directory work.

**Browser evidence already recorded:** desktop/mobile live search → hero NCT07043426 → corrected BMC site → three accessible stops → contact; Spanish navigation and answer reset; no horizontal overflow/uncaught JS errors, and synthetic health answers caused no network requests. Re-test after core fixes and simplify deployment. Route labels are empty; do not invent them or treat unknown accessibility as accessible. Screen-reader/native-speaker checks remain outstanding.

**Reduced directory is PLANNED, NOT IMPLEMENTED and LAST PRIORITY.** Follow [DOCTORS_REDUCED_PLAN.md](DOCTORS_REDUCED_PLAN.md) and `.kiro/specs/find-a-doctor/` only for this reduced scope. Agree the API contract before parallel code. No half-built tab, dead route or mock-only feature on main. The full [post-competition proposal](post-competition/find-a-doctor-full/README.md) is archived reference, not additional work for today.

**Release gates:** complete core English/Spanish hero flow and regressions first. At **4:15 PM ET October 24**, merge the optional directory only if fully finished, integrated, source-checked and browser-verified without delaying core QA or submission; otherwise keep it unmerged/disabled. If starting after the checkpoint, do not implement it for today's submission without Hasan explicitly revising the schedule. **5 PM feature freeze**, then record verified deployed features. Target submit **7:15 PM**, hard deadline **8 PM**. No new features after freeze.

**Submission:** public repo with `.kiro`, working live URL, video under 3 minutes/public upload, accurate Kiro write-up, Healthcare & Biotech track and all three members. Do not borrow recording/upload/submission time for optional work. Record completed work/evidence in KIRO_LOG.md and assignments here.

## Rules of the road (avoid merge conflicts)
- **Update 11:10 (supersedes 10:55):** Neil REBUILDS the frontend in the **Kiro IDE**, spec-first, on a fresh branch `ui/kiro` from main, so the UI is clearly Kiro-built. `neil/frontend` is reference only — **do not merge it**. Order: (1) Akash merges `kiro/steering-docs` → main now; (2) Neil's first Kiro task = scaffold, pushed to main within ~15 min; (3) Hasan pulls and builds the API. Timebox: if the Kiro rebuild isn't at parity by **12:45**, fall back to `neil/frontend` + a retro-spec.
- **Folder ownership:**
  - Hasan → `app/api/**` and NEW files `lib/clinicaltrials.ts`, `lib/mbta.ts`, `lib/bedrock.ts` (reuse Neil's `lib/types.ts`, `lib/geo.ts`)
  - Neil → `app/[lang]/**` pages, `components/**`, styles, `lib/types.ts`, `lib/geo.ts`, `lib/quickCheck.ts`, `lib/i18n/**`, `lib/mock/**`
  - Tests live next to the code (`lib/foo.test.ts`), matching Neil's layout
  - Akash → `.kiro/**`, `tests/**`, `README.md`, `KIRO_LOG.md`
- **Git identity:** perform PR merges through Hasan's authenticated `hasaninan18` account. Integration commits use his configured identity; do not add Codex/Claude bot identities or co-author trailers. Preserve truthful existing tool-use attribution in logs and docs. Verify the authenticated account before merging.
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
