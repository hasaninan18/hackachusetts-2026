# Optional provider directory — reduced submission plan

Status: **planned, not implemented**. This is the last-priority extension. It is not part of the required submission and must remain absent from the live UI unless the complete release gate passes.

This coordination plan adapts Neil's `neil/doctors-plan` proposal (`bfe72e5`). It records agreed scope, not evidence of Kiro execution. The original full proposal is preserved in [post-competition/find-a-doctor-full](post-competition/find-a-doctor-full/README.md). All implementation runs through Kiro.

## Priority and release gate

**Current core blocker:** deployed simplify returned EN/ES HTTP 200, but review found reversed rule-out polarity, mismatched question/source evidence, and a staff-judged CCM criterion asked directly. Fix and semantically verify these outputs first; transport success is not checklist acceptance. Production was rolled back to the prior deployment without simplify (`dpl_9aukErpweSPJAsy8rzwEhxmsXZjW`), while PR #18 remains in main. Hold all main merges, including docs-only changes, until this semantic fix or explicit deployment gating is resolved; automatic deploy could republish the issue. Check current rollout status before demoing it.

Before taking work on this extension, each owner must finish their core assignments in [TASKS.md](TASKS.md). Do not pause a blocking fix, final QA, recording, or submission preparation to build the directory. Separate Kiro agents may work in isolated branches once their owner's core work is safe; additional credits do not waive integration checks.

- **4:15 PM ET, October 24: go/no-go.** Ship only if backend, frontend, contract, real-data verification, English/Spanish browser checks, and core regression checks are complete. Hasan makes the integration decision. If any part or a core blocker is unfinished, leave this feature unmerged/disabled and proceed with the core demo.
- If starting after 4:15 PM, **do not begin implementation for this submission** unless Hasan explicitly revises the schedule. Re-evaluate the actual clock before starting.
- **5 PM: feature freeze.** No new directory features after freeze. Record the video after the final verified feature set is fixed; show only what is actually deployed and working.
- **7:15 PM: target submission; 8 PM: hard deadline.** Preserve recording, upload, write-up, and submission buffer.

## Keep and defer

| Reduced version: keep | Reserve after competition |
|---|---|
| CMS NPI Registry only; individual providers with relevant published taxonomy | HRSA community-health-center dataset and separate group |
| Existing condition/location/radius search context | Additional source integrations or wider geographic coverage |
| Fixed, reviewed condition-to-specialty mapping; primary-care fallback | AI specialty selection or suitability ranking |
| Massachusetts practice addresses, published name/specialty/phone, approximate ZIP-based distance | Exact office geocoding, walking estimates, doctor MBTA/accessibility enrichment |
| Provider tab/list and trial-page link; English and Spanish | New translation work in other languages and extra print-summary features |
| Loading, error, limited-coverage, empty and mock states | Booking, referrals, affiliation, insurance, language, or new-patient claims |

This directory helps someone contact a provider. It does not identify study investigators, make referrals, endorse providers, or imply that a listed provider participates in a trial. Keep the trial's published study-team contact clearly distinct and reachable.

## Phase 0 — documentation and contract (first)

**Owners: Hasan + Neil; Akash reviews safety and testability.** Before code, fetch latest `origin/main` and read current TASKS, this plan, `.kiro/specs/find-a-doctor/`, safety steering, and the relevant installed Next.js guides under `node_modules/next/dist/docs/`. Preserve uncommitted work; do not reset active worktrees.

Read the [official CMS API help](https://npiregistry.cms.hhs.gov/api-page) and [API endpoint](https://npiregistry.cms.hhs.gov/api/) at implementation time. Documentation discovery on October 24 established this allowed API surface:

- `version=2.1`; `enumeration_type=NPI-1` for individual providers; `taxonomy_description`; `state`, `postal_code` or `city`; and `address_purpose=LOCATION`.
- `limit` is at most 200, `skip` is at most 1000. `state` cannot be the only criterion. Taxonomy description supports documented exact/description matching and trailing-wildcard behavior; do not invent taxonomy codes or query semantics.
- CMS notes that an NPI does not validate licensing or credentialing; do not imply that listing establishes either. The NPI API has no radius/latitude/longitude search. Filter and sort locally using the actual MA practice address's ZIP centroid. A bounded query does not establish an exhaustive nearest-provider search.
- Recheck each returned `addresses[]` entry for `address_purpose === "LOCATION"` and `state === "MA"`, even when the query specifies them. Mailing addresses must not become displayed practice locations.

Use the existing `lib/ma-zips.json` shape and `haversineMi` in `lib/geo.ts`. Read `lib/cache.ts` and `app/api/trials/route.ts` for the existing error, validation, bounded-fetch and 10-minute-cache patterns. Do not import server-only modules into client components.

Hasan and Neil agree the following proposed contract **before either edits shared types**. Neil owns the single shared-contract commit; Hasan reviews and consumes it. Do not add directory fields to `TrialDetail` or change existing trial responses.

```ts
// Proposed contract; not code that already exists.
interface ProviderSummary {
  id: string;                    // published NPI identifier
  name: string;                  // published individual provider name
  specialty: string | null;      // published taxonomy description, not an AI claim
  address: string;               // actual practice address
  city: string;
  zip: string;                   // five-digit practice ZIP used for lookup
  phone: string | null;          // published practice phone, unchanged
  distanceMi: number;            // finite, non-negative, ZIP-centroid estimate
  locationPrecision: "zip";
  source: "NPI";
}
interface DoctorsResponse {
  specialty: string;             // reviewed search taxonomy/fallback actually used
  providers: ProviderSummary[];
  coverage: "limited";           // results are from bounded directory queries
  truncated: boolean;            // known page/query cap reached, not exhaustive
}
// GET /api/doctors?cond=&lat=&lon=&radius=
// Errors follow existing { error: string } / ApiError conventions.
```

The query strategy and request budget must be explicit in Kiro's design before implementation: use documented taxonomy plus practice-location filters, a bounded candidate search, bounded pagination and a small maximum displayed list. Define timeout, maximum calls/pages, and returned-result cap; preserve a limited-coverage label even when the cap was not reached. Skip records without a usable MA practice ZIP/centroid; never substitute a mailing ZIP. Do not promise that the list contains every doctor or the objectively nearest doctor.

**Verify:** owners confirm the contract in their PR descriptions; record a minimal official API probe without personal health answers; test one MA practice match and one mailing-only/non-MA exclusion. **Guard:** no HRSA, no extra APIs, no invented radius query, no unbounded fetch-all, no AI specialty inference.

## Phase 1 — backend (Hasan's separate Kiro agent)

Branch/worktree: `feat/doctors-backend` from latest integrated main. Ownership: new `lib/npi.ts`, co-located tests, `app/api/doctors/route.ts` and route tests. No edits to simplify, trial routes, frontend components or shared types after the agreed contract commit.

Copy the existing route validation/cache/fetch patterns cited in Phase 0. Implement the fixed specialty table, individual-provider query, bounded retrieval, MA practice filtering, deduplication, ZIP-centroid distance, inclusive radius filtering and distance-only ordering. Primary care is an explicit fallback for unmapped conditions, not evidence of clinical suitability. Keep missing phone/specialty as unavailable; never invent data.

**Verify:** mocked unit/property tests for malformed records, missing ZIP/phone, mixed mailing/practice addresses, non-MA locations, duplicate providers, finite distances, inclusive radius, ordering, upstream timeout/error, CMS JSON-level errors, request caps and cache behavior. Validate a small real response against the source before display. Show approximate/limited coverage and use “No matching providers found in these directory results” rather than an exhaustive “no doctors exist nearby” claim. No health answers or profiles enter this route.

**Guard:** no per-provider transit calls, office geocoding, eligibility/referral/affiliation inference, ratings, booking, new credentials, or mandatory dependency on this route for trial search/details.

## Phase 2 — frontend (Neil's separate Kiro agent)

**First finish PR #16's blocking fixes:** unavailable generated criteria must not produce positive fit wording from age/condition alone, and the “type 2 diabetes” mock hero search must find NCT07043426. Add permanent regression coverage and finish review before prioritizing the directory.

Then branch/worktree `feat/doctors-ui` from latest main plus the approved contract. Ownership: new provider tab/list/item components, results integration, trial-page link, provider data adapter, English/Spanish copy and real-record mock fixtures. Read the existing results page, `lib/data.ts`, contact/phone rendering, loading/error states, and language-routing patterns before copying them.

- Studies remain the default. Provider tab links retain only existing search context; the trial-page link uses the corrected study-site coordinates and labels that origin clearly.
- A provider item shows source name/taxonomy, actual practice address, published phone when available, approximate distance and a directory-coverage notice. ZIP centroids are not precise offices; do not offer office walking/transit directions from them.
- English and Spanish are the only newly translated provider UI. Preserve the existing six-language trial experience. Do not add missing i18n keys or silently label English copy as another language. Agree a safe unsupported-language path: keep trial views working and offer an explicitly labeled English/Spanish directory choice; unsupported direct directory links must fall back safely rather than crash or show partially translated provider cards.
- Use existing phone-link helpers; keep unknown contact values honest. Loading/error/empty states must not obscure the study contact. If backend integration is absent, do not publish a mock-only tab as a working live feature.
- Use “Ask the study team whether a referral is needed” and “Call to check availability and insurance.” Do not make blanket referral claims, endorsements, trial-affiliation claims, or promises about acceptance/new patients.

**Verify:** real and mock query navigation, query/origin preservation, EN/ES and other-language routes, null phone, errors/empty/limited coverage, keyboard focus, 375px/desktop layout, phone links and no health-answer network payloads. **Guard:** do not edit TrialPlain timeout/simplify while Hasan owns integration; no expansion of reported-results features, HRSA or print scope.

## Phase 3 — QA and evidence (Akash; all owners fix their files)

Akash owns cross-cutting tests under `tests/**`, safety-copy review, QA checklist and evidence. Coordinate with Neil before touching quick-check tests; do not undo the cautious-fallback requirement. Existing submission write-up/evidence work takes priority over optional directory tests.

Read safety steering and existing privacy/forbidden-phrase/property-test patterns. Verify that requests contain only condition/location/radius, and that checklist answers remain in browser memory. Check source fidelity, MA practice filtering, no endorsement/affiliation claims, English/Spanish text, all-language routing safety, unknown contacts, bounded directory coverage, mobile/keyboard and axe where available. Record actual results; no fabricated Kiro tool claims.

**Verify:** full tests, typecheck, lint, production build, real official-source spot check, and complete EN/ES browser flow from search and trial page to provider contact. Re-test the core hero trial, transit, contact, simplify failure/timeout, and radius regression. For generated checklists, verify every question against its source criterion, yes/no rule-out polarity and inclusion/exclusion meaning; staff-judged items belong in staff_checks. HTTP 200 and shape-valid JSON alone do not pass this gate. No live calls in automated tests. **Guard:** screenshots and green unit tests alone do not establish integrated readiness; no partial tab or dead endpoint on main.

## Phase 4 — integration decision (Hasan)

At or before 4:15 PM, merge only after all required source/data, API, frontend, language, privacy, safety and browser checks pass and the core submission is safe. Perform merges as `hasaninan18`; preserve existing attribution and honest evidence. No assistant co-author trailers.

If incomplete, leave the whole directory unmerged/disabled, link the deferred plan in development notes, and exclude it from demo claims. Do not borrow time from video/upload/submission. After the 5 PM freeze only critical regression fixes are allowed. The full roadmap is reserved for after competition; it is not a fallback task queue for today.
