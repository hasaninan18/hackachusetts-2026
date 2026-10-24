# Requirements — simplify (Amazon Bedrock plain-language step)

## Introduction

`POST /api/simplify` turns one recruiting Massachusetts clinical trial into a
plain-language, multilingual "might this fit me?" payload that the frontend trial
page renders. It reuses the existing ClinicalTrials.gov backend (`buildDetailUrl`,
`toDetail`, the 10-minute upstream cache) to load the study, then calls Amazon
Bedrock (Converse API, Nova 2 Lite with a Nova Pro fallback) to generate and
translate a structured, safety-constrained result.

The feature is bound by two external contracts it MUST NOT change:

1. **Safety steering** (`.kiro/steering/safety.md`) — never claim eligibility,
   preserve NCT IDs / phones / emails verbatim, 8th-grade reading level.
2. **The frontend response contract** — the page parses the response through
   `lib/simplify.ts#parseSimplified`, which is owned by another agent and must not
   be edited. The route's success body MUST satisfy that parser.

The 15 prompt rules in `docs/DEMO_DATA.md` are normative for prompt construction
and output validation.

## Ownership / non-goals

- This spec owns only: `lib/bedrock.ts`, new simplify-specific helpers/tests,
  `app/api/simplify/route.ts` and its tests, `.kiro/specs/simplify/**`, and an
  exact-pinned SDK dependency in `package.json`.
- It does NOT edit `lib/simplify.ts`, `lib/types.ts`, frontend files, MBTA files,
  or the trial routes. A required change to any of those is an INTEGRATION
  REQUIREMENT reported upward, not made here.

## Requirements

### Requirement 1 — Request validation
**User story:** As the frontend, I POST `{nct, lang}` and get a clear, safe error
for anything invalid, so I never render a bad payload.

#### Acceptance Criteria
1. WHEN the body is not JSON, or is not an object, THE SYSTEM SHALL respond `400`
   with `{error}`.
2. WHEN `nct` is missing or does not match `^NCT\d{8}$` (case-insensitive,
   trimmed; normalized to upper-case), THE SYSTEM SHALL respond `400`.
3. WHEN `lang` is missing or is not one of the supported set
   `en, es, pt, ht, zh, vi`, THE SYSTEM SHALL respond `400`. The supported set is
   derived from `LANGS` in `lib/types.ts` (imported, not re-declared).
4. Error bodies SHALL be safe (`{error: string}`), contain no secret and no model
   output, and obey the `{error}` shape the frontend already handles.

### Requirement 2 — Load study through existing backend, reuse cache
**User story:** As an operator, study loading reuses the upstream cache so the demo
is fast and cheap.

#### Acceptance Criteria
1. THE SYSTEM SHALL load the study via `buildDetailUrl(nct)` + `cachedFetchJson`
   keyed by the NCT ID, the same key the detail route uses, so a warm upstream
   entry is reused with no new network call.
2. THE SYSTEM SHALL build the domain `TrialDetail` via `toDetail`, reading
   `eligibility` (minAgeYears, maxAgeYears, sex, healthyVolunteers, criteriaText),
   `briefSummary`, `contacts`, `title`, `conditions`, and `nctId` from it.
3. WHEN the upstream returns no study, THE SYSTEM SHALL respond `404`.
4. WHEN the upstream times out or fails and nothing is cached, THE SYSTEM SHALL
   respond with a safe error (`504` timeout / `502` otherwise), never a fabricated
   summary.

### Requirement 3 — Bedrock Converse invocation
**User story:** As the product, the plain-language text comes from Amazon Bedrock
Nova using the team's bearer-token credentials.

#### Acceptance Criteria
1. THE SYSTEM SHALL call Bedrock via `@aws-sdk/client-bedrock-runtime`
   `ConverseCommand`, region from `AWS_REGION`, primary model from
   `BEDROCK_MODEL_ID` (expected `us.amazon.nova-2-lite-v1:0`), fallback from
   `BEDROCK_FALLBACK_MODEL_ID` (expected `us.amazon.nova-pro-v1:0`).
2. Auth SHALL be the bearer token the SDK auto-reads from `AWS_BEARER_TOKEN_BEDROCK`
   (signingName `bedrock`). The code SHALL NOT read, log, or embed the token value.
3. THE SYSTEM SHALL NEVER print, log, or commit secrets, and SHALL NEVER commit
   `.env.local`.
4. Upstream study text SHALL be passed as DATA, never as instructions
   (prompt-injection safe): it is placed in a clearly delimited data block and the
   system prompt tells the model to treat it as untrusted content.

### Requirement 4 — Frontend contract fidelity
**User story:** As the frontend, the success body parses cleanly through
`parseSimplified`.

#### Acceptance Criteria
1. The success body SHALL include the fields `parseSimplified` requires:
   `whatItStudies` (or `summary`), `whatYouDo` (string), and
   `questions: [{id, text, ruleOutIf: "yes"|"no"}]` with 3–6 unique-id questions,
   plus `timeCommitment` and `lang`.
2. THE SYSTEM SHALL return `lang` equal to the requested language.
3. Any additional rule-driven fields (e.g. `source_criterion`, `staff_checks`)
   MAY be included for richness but SHALL NOT break the parser; the three required
   shapes above are the contract.
4. IF implementing the contract would require editing `lib/simplify.ts` or
   `lib/types.ts`, the work SHALL stop and report an INTEGRATION REQUIREMENT
   instead of editing those files.

### Requirement 5 — The 15 prompt rules (DEMO_DATA.md)
**User story:** As a patient, the output is safe, plain, and faithful.

#### Acceptance Criteria (each maps to a DEMO_DATA rule)
1. JSON only, no markdown; the app renders it. (rule 1)
2. 6th–8th grade; summary ≤ 80 words; questions ≤ 20 words; medical terms defined
   in parentheses on first use. (rules 2, 11)
3. Forbidden words never appear: eligible, qualify, qualified, accepted, approved,
   guaranteed, cure, free treatment (and per-language equivalents from
   `safety.md`). (rule 3, Requirement 6)
4. One fact per question; never join two conditions with "and"/"or". (rule 4)
5. Every question maps to a quoted `source_criterion` taken from the criteria
   text; no invented time words or thresholds. (rule 5)
6. Always include an age question built from the structured `minAgeYears` /
   `maxAgeYears`, and a site-patient question when criteria require being a clinic
   patient. (rule 6)
7. At least one patient-answerable exclusion question when one exists;
   administrative / staff-judged / not-self-knowable items go to `staff_checks`,
   never asked. (rule 7)
8. Sensitive topics (pregnancy, mental-health scores, weight/BMI, substance use,
   HIV) are gently worded or moved to `staff_checks`. (rule 8)
9. Questionnaire scores (PHQ-9, GAD-7) are never turned into a self-scored quiz.
   (rule 9)
10. Numbers most people don't know (A1c, eGFR, pack-years) are phrased so
    "I'm not sure" is natural. (rule 10)
11. Summary names the hospital and says what participants do; if randomized,
    include the usual-care sentence; always include "Taking part is your choice."
    (rule 11)
12. Registry logic is restated faithfully, never "corrected." (rule 12)
13. Proxy mode: child/caregiver criteria address the caregiver and add a
    caregiver-age question. (rule 13)
14. Spanish (and other non-English): neutral Latin-American, **usted** register,
    SAME JSON structure, translated FROM the validated English JSON (not
    re-summarized). (rule 14)
15. 3–6 questions, ordered most- to least-likely to rule out. (rule 15)

### Requirement 6 — Never claim eligibility; preserve protected values
#### Acceptance Criteria
1. The output SHALL never state or imply the user is eligible/qualifies/matches/
   is accepted. Validation SHALL reject output containing any forbidden phrase in
   any supported language.
2. NCT IDs, phone numbers, and email addresses present in the source SHALL appear
   in the output byte-for-byte unchanged, or not at all — never reformatted or
   translated.

### Requirement 7 — English-first generation, shape + safety validation, bounded retry
#### Acceptance Criteria
1. THE SYSTEM SHALL generate and validate the English structured output FIRST,
   then translate that structure for non-English requests.
2. Validation SHALL check SHAPE (required fields, 3–6 questions, unique ids,
   `ruleOutIf` enum) AND SAFETY (forbidden phrases, summary word count, preserved
   identifiers) — not merely JSON syntax.
3. WHEN validation fails, THE SYSTEM SHALL retry at most once with a bounded
   request; a second failure SHALL fall through to Requirement 8.

### Requirement 8 — Bounded timeouts, controlled fallback, safe failure
#### Acceptance Criteria
1. Every Bedrock call SHALL have a bounded timeout (AbortController).
2. WHEN the primary model fails or times out, THE SYSTEM SHALL try the fallback
   model at most once; the fallback is NOT invoked an unbounded number of times.
3. WHEN all attempts fail, THE SYSTEM SHALL return a safe error compatible with
   the frontend's structured-check fallback (a `{error}` body with a non-2xx
   status) — NEVER a fabricated summary or reassuring checklist.

### Requirement 9 — Cache successful results by (NCT id, lang)
#### Acceptance Criteria
1. THE SYSTEM SHALL cache a successful, validated result keyed by `(nctId, lang)`.
2. Different languages for the same NCT SHALL be cached separately.
3. THE SYSTEM SHALL NOT cache invalid output, errors, or fallback failures.

### Requirement 10 — Explicit pre-warm path, build/test safe
#### Acceptance Criteria
1. THE SYSTEM SHALL expose an explicit pre-warm function for the demo trials and
   languages from `docs/DEMO_DATA.md`.
2. Pre-warm SHALL NOT run automatically at import/build time and SHALL NOT be
   invoked by the automated test suite; it only runs when explicitly called
   (e.g. a script or an authenticated runtime call).

### Requirement 11 — Tests (all mocked)
#### Acceptance Criteria
1. Focused tests SHALL cover: request validation, successful response,
   malformed/unsafe model output, retry + fallback limits, timeout behavior, cache
   separation by language, and preservation of protected identifiers/contacts.
2. Bedrock SHALL be mocked in every automated test; the suite makes NO live calls.
