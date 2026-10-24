# TrialPath MA — Hackathon Plan
Hackachusetts 2026 · Healthcare & Biotech track (challenge H5: "Making clinical research more accessible")
Repo: https://github.com/hasaninan18/hackachusetts-2026 · Team: Hasan (hasaninan18), Neil (neil066), Akash (akashmishra042006-lgtm)
Hack window: 11:30 AM – **8:00 PM hard deadline** (aim to submit by 7:15)

---

## 1. The pitch (one breath)
3,145 clinical trials are recruiting at Massachusetts sites right now (ClinicalTrials.gov, checked 10/24). Finding one means reading dense medical eligibility text, in English, with no idea how to get there. **TrialPath turns any MA trial into a plain-language, multilingual "might this fit me?" checklist, then shows how to reach the site by the T — including whether the nearest stop is wheelchair accessible.** It never says "you're eligible"; it gets you to a confident conversation with the study team.

Who benefits: patients and caregivers (especially non-English speakers and people without cars), referring clinicians, and research teams struggling to recruit diverse participants.

## 2. Scope — what the demo must show (MVP)
1. **Search**: condition (free text) + where you are (ZIP or "use my location") + max distance → list of recruiting MA trials, nearest first.
2. **Trial card in plain language**: what it studies, what you'd do, time commitment — ~8th-grade reading level.
3. **"Might this fit me?" quick-check**:
   - Instant structured checks from API fields: age range, sex, healthy volunteers.
   - Free-text inclusion/exclusion criteria turned into 3–6 simple yes/no/not-sure questions by an LLM.
   - Result is always one of: "Looks like a possible fit — contact the team", "Some answers may rule you out — ask the team", never "eligible".
4. **Getting there**: nearest MBTA stops to the site (name, lines, ♿ accessible yes/no, walking distance) + one-tap "transit directions" link (Google Maps deep link, no key).
5. **Language toggle**: English, Spanish, Portuguese, Haitian Creole, Chinese, Vietnamese (LLM translation of the plain-language card + questions).
6. **"Contact the study team"**: central contact / site contact from the API, plus a printable/shareable summary to bring to your doctor.

Stretch (only if ahead at 4 PM): save/compare trials; clinician mode (paste a patient's age/condition → shortlist); equity overlay with MassGIS environmental-justice block groups ("trials within 1 mile of an accessible stop in EJ neighborhoods").

### Added idea: reported study results (Neil)
Help people understand what researchers have learned before they contact a study team. On a trial detail page, add **“What has this study found?”** with a link to the original report. This is separate from the “Might this fit me?” checklist: published results do not predict what will happen to one person or decide who can join.

- Show results for the **same NCT ID** when ClinicalTrials.gov has posted them. A recruiting study may have no results yet. Missing or unavailable data must never become “the treatment did not work.”
- When results are available, show what was measured, when it was measured, each study group, the number of people measured in each group, the reported value and units, and reported uncertainty when available. Keep the source's denominator and time period; do not invent a success rate or mix unrelated measures.
- Show a short, source-backed explanation of the finding and any reported harms or limitations, with source link and report/update date. Identify this as a report from the study team; do not generate participant quotes or testimonials.
- Distinguish **“Results not posted”** (the source was checked), **“Results unavailable right now”** (fetch failed), and **“Results have not been checked”** (backend not connected). Always offer the official study link.
- Related completed studies are a later feature. Label them as different studies, show their own NCT IDs and populations, and explain that their results may not apply here. Do not use their outcomes to rank recruiting trials or imply a personal benefit.
- “Comments” initially means a plain-language explanation of published findings, not a public comment feed. Patient stories, ratings, and moderation are outside this MVP.

**Ownership and delivery:** Neil builds the accessible detail-page section and its loading/empty/error states. Hasan supplies verified result data through the detail endpoint; preserve the existing frontend contract with an optional results field. Akash checks source fidelity and safety wording. Ship the sourced-data path only after verifying a real posted-results example; do not attach invented outcome numbers to demo trials. Keep search, the Spanish demo, transit access, and contact flow ahead of this extension.

**Acceptance checks:** no results, fetch failure, and results available render differently; values retain group labels, denominators, units, time periods and source; keyboard and mobile users can read the section; printed summaries include the source; changing checklist answers never changes reported outcomes or sends answers to a server.

### Optional reduced provider directory — last priority

The reduced NPI-only plan is [DOCTORS_REDUCED_PLAN.md](DOCTORS_REDUCED_PLAN.md), with current owner assignments in [TASKS.md](TASKS.md). It is planned, not implemented; only ship a complete verified EN/ES directory after core work is safe and by the 4:15 PM go/no-go. Freeze is 5 PM, with no new feature work after it. NPI practice data/approximate ZIP distances only: no HRSA, doctor transit/geocoding, extra print features or expanded translations. Preserve a safe other-language trial experience.

Neil's original full concept is retained unchanged in [post-competition/find-a-doctor-full](post-competition/find-a-doctor-full/README.md). Its HRSA, transit and broader-language tasks are future reference, not today's scope. Only verified deployed features belong in the video.

Out of scope: accounts, storing health info (nothing leaves the browser except the search query), any eligibility decision.

## 3. Data & APIs (all verified working today)
| Source | Use | Notes |
|---|---|---|
| ClinicalTrials.gov API v2 `https://clinicaltrials.gov/api/v2/studies` | Search + details | No key. Params: `query.cond`, `filter.overallStatus=RECRUITING`, `filter.geo=distance(lat,lon,10mi)`, `fields=...`, `pageSize`. Fields: `eligibilityModule` (criteria text, minimumAge, maximumAge, sex, healthyVolunteers), `contactsLocationsModule.locations[].geoPoint`, `centralContacts` |
| MBTA V3 API `https://api-v3.mbta.com/stops` | Nearest stops to a site | No key needed for demo (get a free key if rate-limited). `filter[latitude]`, `filter[longitude]`, `filter[radius]` (degrees, ~0.01 ≈ 0.7 mi), `filter[route_type]=0,1,2,3`; `wheelchair_boarding` 1 = accessible |
| ZIP → lat/lon | User location | Browser geolocation, or a small static MA ZIP-centroid JSON (Census ZCTA gazetteer) |
| LLM | Plain language, criteria → questions, translation | **Decision needed — see §8** |

## 4. Architecture (keep it boring)
- **Next.js (App Router) + TypeScript + Tailwind**, deployed on **Vercel** (free, gives judges a live link).
- Route handlers:
  - `GET /api/trials?cond=&lat=&lon=&radius=` → proxies ClinicalTrials.gov, slims fields, sorts by distance.
  - `GET /api/trials/[nct]` → full details + nearest MBTA stops.
  - `POST /api/simplify` → LLM: plain summary + questions + translation, **cached per (NCT id, language)** so the demo is fast and cheap.
- Pure functions in `lib/` (easy to property-test): `parseAge("18 Years")`, `quickCheck(profile, eligibility)`, `haversine`, `rankBySite distance`, `readingGrade(text)`.
- Pre-warm the cache for the 5–10 trials used in the demo video.
- Frontend detail (screens, components, API contract): [FRONTEND_PLAN.md](FRONTEND_PLAN.md).

## 5. Kiro strategy (this is 1/3 of the score — Akash owns it, everyone uses it)
Do these **in Kiro**, and commit each so the repo history shows it. Keep a running `KIRO_LOG.md` of what each feature did for you (feeds the write-up).

1. **Steering docs** (`.kiro/steering/`): use Kiro's "Generate steering docs", then edit. Add a custom `safety.md` (see prompt A). 
2. **Spec-driven build**: one spec per feature — `trial-search`, `fit-check`, `getting-there`, `translation`. Requirements (EARS format) → design → tasks; run tasks from the spec.
3. **Agent hooks** (`.kiro/hooks/`):
   - On save in `lib/**` → run unit + property tests.
   - On save of any user-facing copy → check reading grade ≤ 8 and flag forbidden phrases ("you are eligible", "you qualify").
   - Manual hook "update docs" → refresh README + KIRO_LOG.
4. **MCP**: add the `fetch` MCP server (`uvx mcp-server-fetch`) so Kiro can hit ClinicalTrials.gov/MBTA live while designing parsers; optionally Context7 for Next.js docs. Note in write-up what this enabled.
5. **Property-based testing** (fast-check): age parsing never throws and min ≤ max; quickCheck never returns "eligible"; translation output keeps the NCT id and contact info intact; haversine symmetric/non-negative.
6. **Multiple Kiro tools**: IDE for the app, **Kiro CLI** for the data probe scripts + test runs, **Kiro Crew** to run two spec tasks in parallel (e.g., fit-check and getting-there). Screenshot each — judges reward variety.
7. **Powers**: check the Kiro Powers panel for anything relevant (Vercel/Next.js/testing) and use one deliberately.

## 6. Timeline
| Time | Everyone | Hasan — data/LLM backend | Neil — frontend | Akash — Kiro/QA/story |
|---|---|---|---|---|
| 10:40–11:30 | Brainstorm session: lock idea, accept repo invites, all open repo in Kiro, push a test commit | Decide LLM key (§8) | Sketch 3 screens on paper | Install fast-check plan; read Kiro docs on hooks/steering |
| 11:30–12:15 | | | | Steering docs + `safety.md`; first spec `trial-search` (prompt B); set up hooks + fetch MCP |
| 12:15–2:00 | | `/api/trials`, `/api/trials/[nct]`, lib functions | Search page + results list + trial page shell (mock data first) | Specs `fit-check` + `getting-there`; property tests |
| 2:00–4:00 | | `/api/simplify` (LLM + cache), MBTA nearest stops | Fit-check UI, language toggle, getting-there card | Kiro Crew parallel tasks; reading-level hook; KIRO_LOG |
| 4:00–5:00 | **Feature freeze at 5:00** | Deploy to Vercel, pre-warm demo trials | Polish, mobile, a11y (contrast, labels, keyboard) | Bug bash on live URL |
| 5:00–6:15 | Dinner + record | | | Record demo video (script §7), upload to YouTube unlisted→**public** |
| 6:15–7:15 | | README run instructions | Screenshots | Kiro write-up, SundAI card, all 3 members added |
| 7:15–8:00 | **Buffer. Submitted by 7:15.** Verify repo public, `.kiro/` present, video public, live link works in incognito | | | |

## 7. Demo video (< 3 min, no copyrighted music)
1. 0:00–0:20 Problem: "3,145 trials recruiting in MA. Here's what an eligibility section looks like." (show raw criteria wall of text)
2. 0:20–1:30 Maria, Spanish speaker in Dorchester, no car, type 2 diabetes → search → plain-language card in Spanish → 4 quick questions → "possible fit, contact the team" → nearest accessible T stop + directions → printable summary.
3. 1:30–2:20 How we built it with Kiro: steering (safety rules), specs, hooks (reading-level guard), PBT catching a real bug, Crew in parallel.
4. 2:20–2:50 Impact & scale: works for every recruiting MA trial; same API covers all 50 states; clinicians can use it for referrals.

## 8. Decisions / risks
- **LLM — DECIDED: Amazon Bedrock + Amazon Nova** (us-east-2 / Ohio). Model **`us.amazon.nova-2-lite-v1:0`** (best plain-language + translation in testing, ~2 s), fallback **`us.amazon.nova-pro-v1:0`**. Claude on Bedrock is blocked on the AWS Free plan (Marketplace subscriptions not allowed). Use the Bedrock **Converse API** (`POST https://bedrock-runtime.us-east-2.amazonaws.com/model/{modelId}/converse`, header `Authorization: Bearer $AWS_BEARER_TOKEN_BEDROCK`) or `@aws-sdk/client-bedrock-runtime` ConverseCommand. Env vars already set in Vercel project **trialpath-ma**: `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_FALLBACK_MODEL_ID`. Ask Hasan for the key for local `.env.local` (never commit it).
- Overclaiming medical advice → `safety.md` steering + forbidden-phrase hook + PBT. Footer: "TrialPath is not medical advice. The study team decides eligibility."
- Saturation: "trial finder" exists (ClinicalTrials.gov itself, TrialGPT research). Our edge: MA-specific, multilingual, transit + accessibility, plain-language questions, privacy (no health data stored).
- API rate limits during demo → cache + pre-warm.
- Must-not-forget submission checklist: public repo · `.kiro/` committed · video < 3 min public · live URL · description · track = Healthcare & Biotech · Kiro write-up · 3 members added · submitted on SundAI by 8 PM.

## 9. Paste-into-Kiro prompts

**Prompt A — steering (`.kiro/steering/safety.md`)**
> Create a steering doc `safety.md` for TrialPath MA, a tool that helps Massachusetts residents find recruiting clinical trials. Rules: never state or imply a user is eligible or qualifies; the study team decides eligibility; use "may be a possible fit" language; all user-facing English copy at or below 8th-grade reading level; do not store or transmit health answers beyond the browser except the search query; always show the study's contact and the disclaimer "TrialPath is not medical advice"; preserve NCT IDs, phone numbers, and emails exactly when translating.

**Prompt B — first spec**
> Create a spec called `trial-search`. Users enter a condition and a Massachusetts ZIP code or share their location, plus a max distance (5/10/25 miles). The app calls ClinicalTrials.gov API v2 (`/api/v2/studies` with `query.cond`, `filter.overallStatus=RECRUITING`, `filter.geo=distance(lat,lon,Nmi)`) through a Next.js route handler, keeps only Massachusetts sites, and lists trials nearest-first with title, condition, phase, nearest site name/town, and distance. Use Next.js App Router, TypeScript, Tailwind. Put pure logic (age parsing, distance, sorting) in `lib/` with unit and property-based tests (fast-check). Follow the steering docs.

**Prompt C — later specs**: `fit-check` (structured age/sex/healthy-volunteer checks + LLM-generated yes/no/not-sure questions; outcome never says eligible), `getting-there` (MBTA V3 `/stops` near site lat/lon, wheelchair_boarding, walking distance, Google Maps transit deep link), `translation` (6 languages, cached per NCT+language).
