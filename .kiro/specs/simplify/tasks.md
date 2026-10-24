# Tasks — simplify

Status reflects the code on disk at time of writing. Implementation tasks are
checked only when the code actually does them; the live inspection and the PR #16
gate are explicitly NOT done.

## Implementation (default-deny redesign)

- [x] 1. Add the Bedrock SDK dependency
  - `@aws-sdk/client-bedrock-runtime` at an EXACT pinned version (3.1156.0);
    bearer-token auth via `AWS_BEARER_TOKEN_BEDROCK` verified and recorded.
  - _Requirements: 5.2, 5.3_

- [x] 2. Pure type + budget modules (SDK-free)
  - [x] 2.1 `lib/bedrock-types.ts` — `SimplifyQuestion` (server-owned),
        `SimplifyProse`, `SimplifyModel`, `SimplifyBody`. _Requirements: 3.1, 8.1_
  - [x] 2.2 `lib/simplify-budget.ts` — `PER_CALL_TIMEOUT_MS`,
        `STUDY_LOAD_BUDGET_MS`, `BEDROCK_TOTAL_BUDGET_MS`, `MIN_CALL_MS`,
        `SERVER_TOTAL_BUDGET_MS`, `CLIENT_TIMEOUT_FLOOR_MS`; no SDK import.
        _Requirements: 10.1, 10.4, 12.1_
  - [x] 2.3 `lib/bedrock-age.ts` — `isStructuredAgeCriterion`,
        `parseStructuredAgeCitation`. _Requirements: 4.4_

- [x] 3. The default-deny mapping registry (`lib/simplify-mappings.ts`, pure)
  - [x] 3.1 `splitSections` — single heading authority; explicit headings only;
        duplicate/ambiguous/misordered → null; never defaults to inclusion.
        _Requirements: 3.3_
  - [x] 3.2 `FREE_TEXT_MAPPINGS` (t2dm_diagnosis, t1dm_exclusion, hospice) with
        fixed section/kind/ruleOutIf/wording and `disqualifyIfAlsoMatches` keeping
        T1/T2 distinct; verbatim evidence extraction. _Requirements: 3.1, 3.2, 3.4_
  - [x] 3.3 `AGE_MAPPINGS` + structured-age construction; usable-bound bounds
        check; conflicting-bounds → no age question. _Requirements: 4.1–4.4_
  - [x] 3.4 `QUESTION_WORDING_LANGS = ["en","es"]`, `hasQuestionWording`;
        `MIN_SUPPORTED_QUESTIONS = 2`; `buildChecklist` fails closed otherwise.
        _Requirements: 3.5, 3.6, 6.1, 6.2_

- [x] 4. Semantic backstop (`lib/simplify-semantics.ts`, pure)
  - Re-verify server-built questions vs the registry + study facts; negation,
    staff-only, subject-mismatch, section polarity, age polarity; fail closed on any
    disagreement. _Requirements: 7.1, 7.2, 7.3_

- [x] 5. Prose generation + orchestration (`lib/bedrock.ts`)
  - [x] 5.1 Prose-only prompts (`buildEnglishProsePrompt`,
        `buildProseTranslatePrompt`); injection-safe data block; rule-11 encoded.
        _Requirements: 5.1, 5.4_
  - [x] 5.2 `validateProseOutput` (shape, forbidden phrases, ≤80-word summary,
        identifier integrity); `checkProseTranslationInvariants`.
        _Requirements: 5.5, 6.4, 9.1, 9.2_
  - [x] 5.3 `makeConverse` (SDK transport, region env, bearer token never logged);
        `generateSimplified` — build checklist, English prose, assemble, backstop,
        translate prose, localized questions, single shared deadline, bounded
        retry + single fallback. _Requirements: 10.1, 10.2, 10.3, 3.*, 7.*_
  - [x] 5.4 Result cache keyed `(nct, lang)`; no caching of invalid/failed output.
        _Requirements: 11.1, 11.2, 11.3_
  - [x] 5.5 `prewarmDemo` — explicit, never auto-runs at import/test time.
        _Requirements: 13.1, 13.2_

- [x] 6. `app/api/simplify/route.ts`
  - Validate body → 400; load study via upstream cache → 404/502/504; `(nct,lang)`
    cache check; `generateSimplified`; 503 safe error on any Bedrock/checklist
    failure; 200 contract body on success; study load bounded by
    `STUDY_LOAD_BUDGET_MS`. _Requirements: 1.*, 2.*, 8.*, 10.3, 11.*_

- [x] 7. SDK-free client boundary
  - `components/TrialPlain.tsx` imports `CLIENT_TIMEOUT_FLOOR_MS` from
    `lib/simplify-budget.ts`; no client import of `lib/bedrock` or `@aws-sdk`
    (verified by grep). (Client file not owned by this spec — the SDK-free import is
    the sanctioned coupling.) _Requirements: 12.1, 12.2, 10.4_

## Tests (all mocked)

- [x] 8. Pure + route tests
  - [x] 8.1 `simplify-mappings.test.ts`, `simplify-semantics.test.ts`,
        `bedrock.test.ts`, `simplify-budget.test.ts`, `simplify.test.ts` — section
        splitting, checklist construction, backstop branches, prose
        validation/invariants, budgets. _Requirements: 14.1, 14.3_
  - [x] 8.2 `app/api/simplify/route.test.ts` — validation, success + preserved
        identifiers, retry→success, exhaustion→503, timeout/budget→503, cache
        separation by language, no-cache-on-failure. _Requirements: 14.1, 14.3_

- [x] 9. Permanent fail-closed regressions
  - [x] 9.1 Review probes (`lib/review-semantic-bypass.test.ts`): asthma-on-
        diabetes, negated question, wrong age polarity — all rejected.
        _Requirements: 14.2_
  - [x] 9.2 Production regressions, present as named fixtures in
        `lib/simplify-semantics.test.ts` ("DEFECT 1" type-2 question citing a type-1
        exclusion; "DEFECT 2" age citing the diagnosis paragraph; "DEFECT 3" CCM
        asked as a question) — all rejected / fail closed. _Requirements: 14.2_

## Verification and gates (NOT yet done)

- [ ] 10. Full-pipeline verification
  - `npm run typecheck`, `npm run lint`, `vitest run` on changed files + full suite;
    note any pre-existing unrelated failures separately. (Owned by the build agent;
    not run from this spec-only task.)
  - _Requirements: 14.1, 14.3_

- [ ] 11. Live EN/ES inspection (manual, NOT done)
  - Call the real endpoint for NCT07043426 in `en` and `es` and record, for each:
    every question, its evidence, `kind`, `ruleOutIf`, and latency — OR the
    safe-rejection reason if it fails closed. Must be inspected before redeployment;
    green mocked tests and HTTP 200 do NOT establish question correctness.
  - _Requirements: 3.*, 4.*, 6.*, 7.*_

- [ ] 12. PR #16 cautious fallback merged before production restoration (NOT done)
  - The frontend cautious fallback (its own structured quick-check on a non-2xx
    `/api/simplify` response) must be merged (PR #16) before `/api/simplify` is
    restored to production. Do not restore/repromote without it and without the live
    inspection (task 11).
  - _Requirements: 10.3_

- [ ] 13. Commit / push (orchestrator)
  - Stage only owned files; never stage `.env.local` or any secret. (Committing is
    done by the orchestrator, not from this spec-only worker.)
