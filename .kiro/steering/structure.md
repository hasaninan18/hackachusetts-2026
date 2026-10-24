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

## Pure functions to build (all tested)
- `parseAge("18 Years")` → number of years (or null); never throws.
- `quickCheck(profile, eligibility)` → one of `"possible-fit" | "may-rule-out" | "not-sure"`; **never** returns an "eligible" verdict.
- `haversine(a, b)` → kilometers; symmetric and non-negative.
- `rankBySiteDistance(trials, origin)` → trials sorted nearest-first.
- `readingGrade(text)` → estimated grade level (used by the reading-level hook).

## Testing conventions
- Tests live in `lib/__tests__/*.test.ts`.
- Use **Vitest** (run once with `--run`, never watch mode in CI/sandbox).
- **Property-based tests** with **fast-check** for invariants (see the `fit-check` and `trial-search` specs). Run tests via the on-save hook for `lib/**`.

## Naming & copy
- User-facing copy must obey `safety.md` (≤ 8th grade, no forbidden phrases).
- Keep NCT IDs, phone numbers, and emails verbatim everywhere (display and translation).

## Commits
- Small, scoped commits so the repo history shows the Kiro workflow (one commit per steering doc, per spec phase, per hook).
- Branch per unit of work (e.g. `kiro/steering-docs`, `spec/trial-search`); PR into `main`.
