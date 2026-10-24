# Tasks — fit-check

Tasks the existing code already satisfies are marked `[x]` with the file that satisfies them.
Open tasks are grouped by owner per `.kiro/steering/structure.md`:
- **Neil** owns `lib/**` (except Hasan's API clients) and `components/**` and `lib/i18n/**`.
- **Akash** owns `.kiro/**`, `tests/**`, `README.md`, `KIRO_LOG.md`.

Nothing in `lib/` or `components/` is edited by this spec — the Neil tasks below are the handoff.

---

## Already satisfied by existing code

- [x] 1. Pure two-outcome decision core (`possible-fit` / `ask-team`) with reasons
  - `lib/quickCheck.ts` — `FitOutcome`, `FitReason`, `quickCheck()`; `outcome = reasons.length ? "ask-team" : "possible-fit"`.
  - _Requirements: 5.1, 5.2, 5.3_
- [x] 2. Structured age check with inclusive bounds and open (`null`) bounds
  - `lib/quickCheck.ts` — `age-too-young` / `age-too-old` branches; verified by `lib/quickCheck.test.ts` ("age boundaries are inclusive").
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
- [x] 3. Structured sex check only for single-sex studies
  - `lib/quickCheck.ts` — `sex` reason when `eligibility.sex !== "ALL"`; `lib/quickCheck.test.ts` ("sex mismatch is flagged only for single-sex studies").
  - _Requirements: 1.5, 1.6_
- [x] 4. Healthy-volunteer check only when the study excludes healthy volunteers
  - `lib/quickCheck.ts` — `healthy-volunteer` reason when `healthyVolunteers === false`; `lib/quickCheck.test.ts`.
  - _Requirements: 1.7, 1.8_
- [x] 5. Missing fields and "not sure" never rule anyone out
  - `lib/quickCheck.ts`; `lib/quickCheck.test.ts` ("'not sure' answers and an empty profile never rule anyone out").
  - _Requirements: 1.9, 3.3_
- [x] 6. Generated questions answered yes / no / not-sure; `ruleOutIf` records an `answer` reason
  - `lib/quickCheck.ts` (answer loop) + `components/QuickCheck.tsx` (three-pill groups); `lib/quickCheck.test.ts`.
  - _Requirements: 3.1, 3.2_
- [x] 7. Age input accepts only a whole number 0–120, debounced, with an error for bad input
  - `components/QuickCheck.tsx` — `parseAge`, `AGE_COMMIT_MS` debounce, `fit.ageError`.
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
- [x] 8. Answers dropped when the question set changes
  - `components/QuickCheck.tsx` — `questionSet` signature + `answerState`.
  - _Requirements: 3.6_
- [x] 9. Loading state with `aria-busy`; no result while questions load
  - `components/QuickCheck.tsx` — skeletons, `status === "loading"` gate.
  - _Requirements: 3.4, 9 (loading)_
- [x] 10. "No questions" shows the "ask the study team about the remaining rules" message
  - `components/QuickCheck.tsx` — `fit.noQuestions` when `questions.length === 0`.
  - _Requirements: 3.5, 7.5_
- [x] 11. Result gating + progress + single live-region announcement
  - `components/QuickCheck.tsx` — `showResult`, `fit.progress`, `role="status"` with flip space.
  - _Requirements: 9.1, 9.2, 9.3, 9.4_
- [x] 12. Two outcomes rendered; amber for ask-team (never red); reasons listed; question text in its own language
  - `components/FitResult.tsx` — `fit-bg` vs `ask-bg`, reason `<ul>`, `reasonText` `answer` case with `lang`.
  - _Requirements: 5.4, 5.5, 5.6_
- [x] 13. Fit-check copy avoids forbidden phrases and claims (≤ 8th grade)
  - `lib/i18n/en.ts` copy; enforced by the copy-guard hook (`tests/copy-guard.mjs`) and `lib/i18n/i18n.test.ts` ("en never claims eligibility").
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
- [x] 14. Answers held in-browser only (no fetch / storage / logging of answers)
  - `components/QuickCheck.tsx` — all answers in React state; only the trial lookup leaves the device.
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
- [x] 15. Core does not throw on arbitrary criteria text
  - `lib/quickCheck.ts` reads `criteriaText` only via the structured fields (today it does not parse it); covered by `tests/safety.property.test.ts` (malformed-text property).
  - _Requirements: 7.7 (no-throw portion)_
- [x] 16. Verbatim disclaimer shown on the trial view surrounding the fit-check
  - `lib/i18n/en.ts` `"disclaimer"` = exact §4 text; `lib/i18n/i18n.test.ts` ("the disclaimer is exactly the safety.md §4 text").
  - _Requirements: 10.2_

---

## Open — Neil (owns `lib/**`, `components/**`, `lib/i18n/**`)

These implement Requirement 7 (empty/malformed, question-less criteria → `ask-team`). The exact
diffs and tests are in `design.md` → "Proposed change for the owner". Narrow scope: fire only when
`questions.length === 0` AND `criteriaText` has no letter or digit (empty / whitespace-only /
symbols-only). Non-empty text with no questions keeps the structured result + `fit.noQuestions`.
This preserves the tech.md LLM-failure fallback.

- [ ] N1. Add `"insufficient-info"` to `FitReason.kind`
  - File: `lib/quickCheck.ts` (see design Change 1).
  - _Requirements: 7.1_
- [ ] N2. Record `insufficient-info` when `questions.length === 0` AND criteria have no letter/digit
  - File: `lib/quickCheck.ts` (design Change 2; `/[\p{L}\p{N}]/u` content test). Must NOT fire when a question exists (7.4) or when text has content (7.5), preserving the LLM-failure fallback.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
- [ ] N3. Render the new reason
  - File: `components/FitResult.tsx` (design Change 3) — add the `insufficient-info` case to `reasonText`, caution styling (reuses the existing amber `ask-team` panel), never a failure/eligibility claim.
  - _Requirements: 7.6_
- [ ] N4. Add the i18n key `fit.reason.insufficient-info` (≤ 8th grade, no forbidden phrases)
  - File: `lib/i18n/en.ts` (design Change 4). Add the mirrored key to the other dictionaries before each language ships; run copy-guard on the new string.
  - _Requirements: 6.4, 7.6_
- [ ] N5. Co-located tests for the new behavior
  - File: `lib/quickCheck.test.ts` (design Change 5) — empty, whitespace-only, symbols-only → `ask-team` with `insufficient-info`; has-question and has-content (LLM-fallback path) → not fired.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
- [ ] N6. (Requirement 4) Show the original criterion beside each question
  - Files: `lib/types.ts` (add optional `sourceCriterion?: string` to `FitQuestion`), `components/QuickCheck.tsx` (render it beside the question, verbatim, with its own `lang`). Additive — `quickCheck` ignores the field, so the core contract and existing tests are unchanged.
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

## Open — Akash (owns `.kiro/**`, `tests/**`, `KIRO_LOG.md`)

- [ ] A1. Flip the cross-cutting property to the new contract (lands with Neil's PR)
  - File: `tests/safety.property.test.ts` — change the "empty/malformed text with no questions → possible-fit" property to "`questions.length === 0` AND no letter/digit → `ask-team` with `insufficient-info`"; keep possible-fit for text-with-content or any question. Also add a symbols-only case to the never-throws arbitrary.
  - _Requirements: 7.1, 7.2, 7.3, 7.7_
- [x] A2. Requirements + design authored, with the precise "malformed" definition and the LLM-fallback note
  - Files: `.kiro/specs/fit-check/requirements.md`, `.kiro/specs/fit-check/design.md`.
  - _Requirements: all_
- [x] A3. Log the finding + decision + ownership
  - File: `KIRO_LOG.md` (Specs section).
  - _Requirements: 7_
- [ ] A4. After Neil's PR merges, record the outcome in `KIRO_LOG.md`
  - File: `KIRO_LOG.md` — note the behavior shipped and the property flip, only what was observed.
  - _Requirements: 7_
