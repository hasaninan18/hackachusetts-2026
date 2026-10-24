# Tasks — simplify

- [ ] 1. Add the Bedrock SDK dependency
  - Install `@aws-sdk/client-bedrock-runtime` at an EXACT pinned version.
  - Verify in the installed SDK that bearer-token auth via
    `AWS_BEARER_TOKEN_BEDROCK` is supported; record the version + finding.
  - _Requirements: 3.1, 3.2_

- [ ] 2. Pure helpers in `lib/bedrock.ts`
  - [ ] 2.1 `parseNct`, `SUPPORTED_LANGS` (from `LANGS`), `FORBIDDEN_PHRASES`
        (English + es/pt/ht/zh, vi placeholder), `extractProtectedValues`.
        _Requirements: 1.2, 1.3, 6.1, 6.2_
  - [ ] 2.2 `buildEnglishPrompt` — injection-safe delimited data block; encodes
        rules 2–13, 15; structured age bounds for the age question.
        _Requirements: 3.4, 5.*_
  - [ ] 2.3 `buildTranslatePrompt` — rule 14 (usted, same structure/ids, preserve
        identifiers). _Requirements: 5.14, 6.2, 7.1_
  - [ ] 2.4 `validateModelOutput` — shape + safety (forbidden phrases, ≤80-word
        summary, 3–6 unique-id questions, source_criterion substring, identifiers
        preserved). Never throws. _Requirements: 5.*, 6.*, 7.2_
  - [ ] 2.5 `toResponseBody` (adds `whatItStudies`, `lang`). _Requirements: 4.1, 4.2_

- [ ] 3. Bedrock I/O + orchestration in `lib/bedrock.ts`
  - [ ] 3.1 `makeConverse` — `BedrockRuntimeClient` (region env), `ConverseCommand`,
        AbortController timeout, returns first output text; never logs the token.
        _Requirements: 3.1, 3.2, 3.3, 8.1_
  - [ ] 3.2 `generateSimplified` — English-first, validate, retry once, fallback
        model once, then translate for non-English; bounded; returns typed result.
        _Requirements: 7.1, 7.3, 8.2, 8.3_
  - [ ] 3.3 Result cache keyed `(nct, lang)`; no caching of invalid/failed output.
        _Requirements: 9.1, 9.2, 9.3_
  - [ ] 3.4 `prewarmDemo` — explicit, never auto-runs at import/test time.
        _Requirements: 10.1, 10.2_

- [ ] 4. `app/api/simplify/route.ts`
  - Validate body → 400; load study via upstream cache (`buildDetailUrl` +
    `cachedFetchJson`, `toDetail`) → 404/502/504; `(nct,lang)` cache check;
    orchestrate; 503 safe error on Bedrock failure; 200 contract body on success.
  - _Requirements: 1.*, 2.*, 4.*, 8.3, 9.*_

- [ ] 5. Tests (all mocked)
  - [ ] 5.1 `lib/bedrock.test.ts` — pure helpers + validator cases.
        _Requirements: 11.1, 11.2_
  - [ ] 5.2 `app/api/simplify/route.test.ts` — validation, success+preserved
        identifiers, malformed→retry, retry+fallback exhaustion→503, timeout→503,
        cache separation by language, no-cache-on-failure. _Requirements: 11.1, 11.2_

- [ ] 6. Verify
  - `npm run typecheck`, `npm run lint`, `vitest run` on changed files + full suite.
  - Note the 5 pre-existing `lib/i18n/i18n.test.ts` failures separately.

- [ ] 7. One minimal live Converse call (only if env vars present)
  - Load `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK`, `BEDROCK_MODEL_ID` from the
    environment if available; do NOT fabricate. Report success/model/error; log
    no secrets. If absent, say so plainly.

- [ ] 8. Commit on `feat/simplify`, push `-u origin feat/simplify`
  - Stage only owned files; never stage `.env.local` or any secret.
