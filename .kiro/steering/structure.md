# Structure & Conventions (TrialPath MA)

## Folder layout
```
app/
  page.tsx                 # search page
  trials/[nct]/page.tsx    # trial detail (plain-language card, quick-check, getting-there)
  api/
    trials/route.ts        # GET /api/trials
    trials/[nct]/route.ts  # GET /api/trials/[nct]
    simplify/route.ts      # POST /api/simplify (LLM + cache)
components/                # presentational React components
lib/                       # PURE functions — no I/O, easy to test
  age.ts                   # parseAge("18 Years") -> number | null
  distance.ts              # haversine(a, b)
  rank.ts                  # rankBySiteDistance(trials, origin)
  quickCheck.ts            # quickCheck(profile, eligibility) -> never "eligible"
  reading.ts               # readingGrade(text)
data/                      # static assets (MA ZIP centroids, demo fixtures)
lib/__tests__/             # unit + property-based tests (fast-check)
docs/                      # PLAN.md, etc.
.kiro/
  steering/                # safety.md, product.md, tech.md, structure.md
  specs/                   # trial-search, fit-check, getting-there, translation
  hooks/                   # test-on-save, reading-level guard, update-docs
KIRO_LOG.md                # running log of what Kiro did (feeds the write-up)
```

## Core principle: pure logic in `lib/`
- Business logic lives in `lib/` as **pure functions** (no fetch, no randomness, no clock) so it is trivially unit- and property-testable.
- Route handlers do I/O (fetch external APIs, call Bedrock) and delegate all parsing/ranking/decision logic to `lib/`.

## Units — decide once, convert at the edges
Mixed units are a known bug source (UI is **miles**, MBTA radius is **degrees**, geo math is easiest in **km**).
- `lib/` works in **ONE canonical unit: kilometers**. All distance math returns km.
- Convert at the boundaries only: `milesToKm` / `kmToMiles` for the UI (5/10/25 mi), and a single `kmToMbtaDegrees` helper (~0.7 mi ≈ 0.01°) for the MBTA radius.
- A property test must cover the round-trips: `kmToMiles(milesToKm(x)) ≈ x` and `kmToMbtaDegrees` monotonic & non-negative.

## Pure functions to build (all tested)
- `parseAge("18 Years")` → age **in years** (or null); never throws. Must handle `"6 Months"` (→ 0.5), `"N/A"`, `"No maximum"`, empty, and junk strings.
- `quickCheck(profile, eligibility)` → one of `"possible-fit" | "may-rule-out" | "not-sure"`. (The type already excludes "eligible" — so test real behavior, not the type; see below.)
- `haversine(a, b)` → **kilometers**; symmetric and non-negative.
- `milesToKm` / `kmToMiles` / `kmToMbtaDegrees` → unit conversions, used only at boundaries.
- `rankBySiteDistance(trials, origin)` → trials sorted nearest-first (km).
- `readingGrade(text)` → estimated grade level (used by the reading-level hook).

## Property-based tests (fast-check) — make them earn their keep
Don't test what the type system already guarantees. Test behavior:
- **`parseAge`**: never throws on any string; when both bounds parse, `min ≤ max`; `"6 Months"` < `"1 Years"`; `"N/A"`/`"No maximum"` → null (open bound), not a crash.
- **`quickCheck` monotonicity**: adding a *disqualifying* answer never **improves** the outcome (possible-fit → may-rule-out/not-sure, never the reverse).
- **`quickCheck` out-of-range age** → always `"may-rule-out"`.
- **`quickCheck` empty/malformed eligibility text** → never `"possible-fit"` (fall back to `"not-sure"`).
- **`haversine`**: symmetric (`h(a,b)==h(b,a)`), non-negative, zero for identical points.
- **unit conversions**: round-trip within tolerance; `kmToMbtaDegrees` monotonic & non-negative.
- **translation invariants** (string-level): output preserves every NCT id, phone, and email from the input verbatim.

## Testing conventions
- Tests live in `lib/__tests__/*.test.ts`.
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
- **API rate-limit / fetch failure** — friendly retry message; fall back to cached/pre-warmed data for demo trials where available.
- **Loading** — skeletons/spinners with accessible `aria-busy`.
- All empty/error copy obeys `safety.md` (≤ 8th grade, no forbidden phrases).

## Naming & copy
- User-facing copy must obey `safety.md` (≤ 8th grade, no forbidden phrases).
- Keep NCT IDs, phone numbers, and emails verbatim everywhere (display and translation).

## Commits
- Small, scoped commits so the repo history shows the Kiro workflow (one commit per steering doc, per spec phase, per hook).
- Branch per unit of work (e.g. `kiro/steering-docs`, `spec/trial-search`); PR into `main`.
