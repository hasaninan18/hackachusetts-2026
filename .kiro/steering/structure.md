# Structure & Conventions (TrialPath MA)

## Folder layout (matches Neil's scaffold + TASKS.md ownership)
```
app/
  [lang]/**                # localized pages (Neil)
  api/
    trials/route.ts        # GET /api/trials            (Hasan)
    trials/[nct]/route.ts  # GET /api/trials/[nct]       (Hasan)
    simplify/route.ts      # POST /api/simplify (LLM)    (Hasan)
components/                # presentational React components (Neil)
lib/                       # PURE functions — no I/O, easy to test
  types.ts                 # shared types                (Neil)
  geo.ts                   # haversineMiles, nearestSite (Neil)
  quickCheck.ts            # quickCheck -> never "eligible" (Neil)
  i18n/**                  # translations/strings        (Neil)
  mock/** , mock.ts        # mock data until APIs ready   (Neil)
  clinicaltrials.ts        # ClinicalTrials.gov client   (Hasan)
  mbta.ts                  # MBTA stops client           (Hasan)
  bedrock.ts               # Bedrock Converse client     (Hasan)
  geo.test.ts              # tests live NEXT TO the code (co-located)
data/                      # static assets (MA ZIP centroids, demo fixtures)
tests/                     # cross-cutting / property tests (Akash)
docs/                      # PLAN.md, TASKS.md
.kiro/
  steering/                # safety.md, product.md, tech.md, structure.md
  specs/                   # trial-search-api, getting-there, simplify, trialpath-ui
  hooks/                   # test-on-save, copy-guard, update-docs
KIRO_LOG.md                # running log of what Kiro did (feeds the write-up)
```

### Folder ownership (avoid merge conflicts — from docs/TASKS.md)
- **Hasan** -> `app/api/**`, new `lib/clinicaltrials.ts`, `lib/mbta.ts`, `lib/bedrock.ts` (reuses Neil's `lib/types.ts`, `lib/geo.ts`).
- **Neil** -> `app/[lang]/**`, `components/**`, styles, `lib/types.ts`, `lib/geo.ts`, `lib/quickCheck.ts`, `lib/i18n/**`, `lib/mock/**`.
- **Akash** -> `.kiro/**`, `tests/**`, `README.md`, `KIRO_LOG.md`.

## Core principle: pure logic in `lib/`
- Business logic lives in `lib/` as **pure functions** (no fetch, no randomness, no clock) so it is trivially unit- and property-testable.
- Route handlers do I/O (fetch external APIs, call Bedrock) and delegate all parsing/ranking/decision logic to `lib/`.

## Units — decide once, convert at the edges
Mixed units are a known bug source (UI uses 5/10/25 **mi**, MBTA radius is in **degrees**). **Decision: `lib/` is canonical MILES.** All distance math returns miles.
- `haversine(a, b)` returns **miles**. `rankBySiteDistance` sorts by miles. Walking distances display in miles.
- Convert only at the one boundary that needs it: `milesToMbtaDegrees` (~0.7 mi ≈ 0.01°) when building the MBTA `filter[radius]`.
- A property test must cover: `milesToMbtaDegrees` monotonic & non-negative; haversine in miles symmetric/non-negative/zero for identical points.

## Pure functions to build (all tested)
- `parseAge("18 Years")` → age **in years** (or null); never throws. Must handle `"6 Months"` (→ 0.5), `"N/A"`, `"No maximum"`, empty, and junk strings.
- `quickCheck(profile, eligibility)` → one of `"possible-fit" | "may-rule-out" | "not-sure"`. (The type already excludes "eligible" — so test real behavior, not the type; see below.)
- `haversine(a, b)` → **miles**; symmetric and non-negative.
- `milesToMbtaDegrees(mi)` → degrees for the MBTA radius; used only at the API boundary.
- `rankBySiteDistance(trials, origin)` → trials sorted nearest-first (miles).
- `readingGrade(text)` → estimated grade level (used by the reading-level hook).

## Property-based tests (fast-check) — make them earn their keep
Don't test what the type system already guarantees. Test behavior:
- **`parseAge`**: never throws on any string; when both bounds parse, `min ≤ max`; `"6 Months"` < `"1 Years"`; `"N/A"`/`"No maximum"` → null (open bound), not a crash.
- **`quickCheck` monotonicity**: adding a *disqualifying* answer never **improves** the outcome (possible-fit → may-rule-out/not-sure, never the reverse).
- **`quickCheck` out-of-range age** → always `"may-rule-out"`.
- **`quickCheck` empty/malformed eligibility text** → never `"possible-fit"` (fall back to `"not-sure"`).
- **`haversine`** (miles): symmetric (`h(a,b)==h(b,a)`), non-negative, zero for identical points.
- **`milesToMbtaDegrees`**: monotonic & non-negative.
- **translation invariants** (string-level): output preserves every NCT id, phone, and email from the input verbatim.

## Testing conventions
- Tests live **next to the code** they test: `lib/geo.ts` -> `lib/geo.test.ts` (matches Neil's layout; do **not** use `lib/__tests__/`).
- Cross-cutting / property-test suites that aren't tied to one module go in `tests/` (Akash's folder).
- Use **Vitest** (run once with `--run`, never watch mode in CI/sandbox).
- **fast-check** for the invariants above. Run tests via the on-save hook for `lib/**`.

## Accessibility (required, not optional)
Accessibility is core to the product thesis (reaching people without cars, non-English speakers, disabled users) and is judged. Every UI component must:
- **Mobile-first**, responsive layout; large tap targets (≥ 44×44 px).
- Sufficient **color contrast** (WCAG AA); never convey info by color alone.
- **Labels** on every form control; visible focus states; full **keyboard navigation**.
- **Screen-reader text** for icons — especially the ♿ accessible-stop icon (e.g. `aria-label="Wheelchair accessible stop"` vs. `"Accessibility unknown"`); never a bare icon.
- Respect `prefers-reduced-motion`; don't trap focus in modals.

## Empty & error states (generate these, don't leave them blank)
Kiro must produce explicit UI for:
- **No trials found** — plain-language "no recruiting trials near you; try a wider distance or a different term," with a widen-radius action.
- **No transit nearby** — "no T stops found within walking distance" instead of an empty list; still show the Google Maps directions link.
- **API rate-limit / timeout / fetch failure** — friendly retry message; fall back to cached/pre-warmed data for demo trials where available.
- **LLM failure** — fall back to the **structured quick-check only** (age/sex/healthy-volunteer checks); skip the generated questions and show the plain fallback copy. Never block the whole trial view on the LLM.
- **No transit stop nearby** — say "no nearby transit" and still show a **driving** directions link (not just transit).
- **Loading** — skeletons/spinners with accessible `aria-busy`.
- All empty/error copy obeys `safety.md` (≤ 8th grade, no forbidden phrases).

## Naming & copy
- User-facing copy must obey `safety.md` (≤ 8th grade, no forbidden phrases).
- Keep NCT IDs, phone numbers, and emails verbatim everywhere (display and translation).

## Commits
- Small, scoped commits so the repo history shows the Kiro workflow (one commit per steering doc, per spec phase, per hook).
- Branch per unit of work (e.g. `kiro/steering-docs`, `spec/trial-search`); PR into `main`.
