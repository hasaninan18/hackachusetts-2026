# Find a doctor — reduced optional tasks

Status: **not started**. Last priority; completing this checklist is not required for submission. Core blockers in `docs/TASKS.md` come first. Do not claim tasks complete until code and evidence establish it.

- [ ] 0. Hasan/Neil/Akash: read current main docs, check clock, and confirm each owner's core work is safe; agree contract, bounded query strategy/caps and language fallback from `docs/DOCTORS_REDUCED_PLAN.md`. No new implementation for this submission after 4:15 PM without an explicit revised schedule.
- [ ] 1. Neil: land the single shared-contract change after Hasan reviews it; preserve existing trial contracts. Coordinate isolated backend/UI worktrees.
- [ ] 2. Hasan's separate Kiro agent: NPI-only backend, MA practice-location filter, fixed specialty/fallback, ZIP approximation, radius/ranking, limits/cache/error handling and focused mocked tests.
- [ ] 3. Neil's separate Kiro agent: only after PR #16 blockers are fixed, implement tab/list/link and states with EN/ES copy, safe other-language navigation and source/coverage labels; no HRSA/transit/extra print scope.
- [ ] 4. Akash: source/privacy/safety/cross-cutting QA and actual evidence; coordinate tests with Neil. No health answers in provider requests; no affiliation/endorsement claims.
- [ ] 5. All: source spot check, full tests/typecheck/lint/build, real EN/ES browser flow, mock/empty/error/timeout, 375px/desktop/keyboard checks and core hero-flow regression review.
- [ ] 6. Hasan: at/before 4:15 PM, merge only if complete and core safe; otherwise leave the whole feature unmerged/disabled. Freeze at 5 PM and record only verified deployed behavior.

Do not execute the [post-competition full proposal](../../../docs/post-competition/find-a-doctor-full/README.md) as additional tasks today.
