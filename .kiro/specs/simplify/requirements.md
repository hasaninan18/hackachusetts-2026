# Requirements — simplify (Amazon Bedrock plain-language step)

## Introduction

`POST /api/simplify` turns one recruiting Massachusetts clinical trial into a
plain-language, multilingual "might this fit me?" payload that the frontend trial
page renders. It reuses the existing ClinicalTrials.gov backend (`buildDetailUrl`,
`toDetail`, the upstream cache) to load the study, then produces a structured,
safety-constrained result.

This document describes the design **as redesigned** after a production incident.
The checklist is no longer authored by the model and validated after the fact. The
server now BUILDS the checklist from a finite registry of deterministic
criterion-to-question mappings, and the model authors only prose. The mapping table
and the code behavior described here are reported **as implemented at time of
writing** (the implementation may still change).

The feature is bound by two external contracts it MUST NOT change:

1. **Safety steering** (`.kiro/steering/safety.md`) — never claim eligibility,
   preserve NCT IDs / phones / emails verbatim, 8th-grade reading level.
2. **The frontend response contract** — the page parses the response through
   `lib/simplify.ts#parseSimplified`, which is owned by another agent and must not
   be edited. The route's success body MUST satisfy that parser.

The 15 prompt rules in `docs/DEMO_DATA.md` are normative for prompt construction
and output validation.

## Why the old design failed (default-allow)

The previous pipeline was **default-allow**: the model authored each question
(text, `kind`, `ruleOutIf`, `source_criterion`), and a validator accepted the
output unless it matched a specific mistake the validator had been taught. HTTP 200,
green mocked tests, and substring matching of a cited quote established transport,
auth, and shape — **not semantic correctness**.

### Production incident (rolled back)

PR18 reached production (deployment `dpl_yUEMKme13fudtLx3wPqSykXdUdU8`) and returned
HTTP 200 for the hero trial NCT07043426 in English (~2.93s) and Spanish (~5.25s). The
returned English checklist was semantically wrong:

- A **type-2 question cited a type-1 exclusion**: `text: "Do you have type 2
  diabetes?"`, `kind: exclusion`, `ruleOutIf: yes`, `source_criterion: "Patients
  with Type 1 Diabetes Mellitus (T1DM)."` Answering **Yes** to type 2 diabetes
  therefore triggered a rule-out based on a **type 1** exclusion. Spanish preserved
  the same mistaken rule and evidence.
- The **age question cited diagnosis text**: "Are you at least 18 years old?" cited
  the diabetes-diagnosis inclusion paragraph, not the structured age bounds.
- **Complex Care Management (CCM) enrollment was asked as a question**, despite the
  prompt rules directing administrative/staff-judged items to `staff_checks`.

Production was rolled back to the prior deployment without `/api/simplify`
(`dpl_9aukErpweSPJAsy8rzwEhxmsXZjW`). The substring-match and translation validators
did not detect the meaning mismatch.

### Three review probes the default-allow validator accepted

A separate review demonstrated three bypasses the old validator passed:

1. **Unrelated subject**: "Do you have asthma?" cited to T2DM evidence — the
   validator never required the question subject to equal the evidence subject
   outside a known family.
2. **Negated question**: "Do you NOT have type 2 diabetes?" kept the positive rule
   (`kind: inclusion`, `ruleOutIf: no`) — the negation flipped the meaning but
   nothing flipped or checked the rule.
3. **Wrong age polarity**: "Are you at least 18 years old?" cited `minimumAge` with
   `kind: exclusion`, `ruleOutIf: yes` — the age path checked field and value but
   never age polarity.

These three probes are preserved permanently as fail-closed acceptance tests
(`lib/review-semantic-bypass.test.ts`); the three production mistakes are preserved
as regression fixtures.

## The new design (default-deny, server-built checklist)

The fix is a design change, not more keyword checks:

- A **finite registry** of deterministic criterion-to-question mappings
  (`lib/simplify-mappings.ts`).
- The **server constructs** each question's `text`, `kind`, `ruleOutIf`, and
  `source_criterion` from verified registry facts. The model does not author
  checklist logic; any model-proposed ids or facts are verified against the
  registry, never trusted.
- **Default-deny**: unknown subjects, unsupported wording, ambiguous evidence,
  compound or negated criteria without a mapping, and missing or ambiguous headings
  are REJECTED. Missing/ambiguous headings never default to inclusion.
- **Age** is built only from the structured `minAgeYears` / `maxAgeYears` fields.
  Missing, conflicting (`min > max`), or non-finite bounds produce no age question,
  and nothing is inferred from free text.
- **Type 1 and type 2** are distinct mappings; a line carrying a confusable sibling
  fact fails closed.
- **Staff-only** criteria (CCM enrollment, deceased, consent ability, opted-out,
  investigator judgment, record-only lab cutoffs) never become questions.
- **Deterministic localized wording** for `en` and `es` (Spanish `usted` register).
  Model translation is limited to prose that is still safety- and
  identifier-checked and cannot change disease type, negation, numbers, or age
  direction.
- `MIN_SUPPORTED_QUESTIONS` and unsupported languages/studies return a **safe
  error** compatible with the cautious frontend fallback (PR #16).

## Ownership / non-goals

- This spec owns only: `lib/bedrock.ts`, `lib/bedrock-types.ts`, `lib/bedrock-age.ts`,
  `lib/simplify-mappings.ts`, `lib/simplify-semantics.ts`, `lib/simplify-budget.ts`,
  their tests, `app/api/simplify/route.ts` and its tests, `.kiro/specs/simplify/**`,
  and an exact-pinned SDK dependency in `package.json`.
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

### Requirement 3 — Server-built deterministic checklist (default-deny)

**User story:** As a patient, the yes/no checklist reflects the trial's real
criteria — not whatever the model chose to write — so a wrong answer never rules me
in or out for the wrong reason.

#### Acceptance Criteria

1. THE SYSTEM SHALL construct every question's `text`, `kind`, `ruleOutIf`, and
   `source_criterion` from a supported mapping in the finite registry
   (`lib/simplify-mappings.ts`), never from model output.
2. THE SYSTEM SHALL extract `source_criterion` VERBATIM from the study's registry
   text (free-text mappings) or format it from the structured bounds (age
   mappings) — never copy the model's quote.
3. A free-text mapping SHALL match only inside the section it declares
   (inclusion/exclusion), and only when that section is unambiguously delimited by
   exactly one explicit heading. WHEN headings are missing, duplicated, or ordered
   ambiguously, the section is null and dependent mappings fail closed. Missing or
   ambiguous headings SHALL NOT default to inclusion.
4. Type-1 and type-2 criteria SHALL be distinct mappings; a matched line that also
   carries a confusable sibling fact SHALL be skipped (fail closed).
5. WHEN a subject is unknown, wording is unsupported, evidence is ambiguous, or a
   criterion is compound/negated without a mapping, THE SYSTEM SHALL produce no
   question for it (fail closed).
6. WHEN fewer than `MIN_SUPPORTED_QUESTIONS` (currently 2) questions can be
   constructed, THE SYSTEM SHALL return a safe error rather than a thin, reassuring
   list.

### Requirement 4 — Age from structured bounds only

**User story:** As a patient, the age question reflects the trial's real age limits
and asks them the right way round.

#### Acceptance Criteria

1. Age questions SHALL be built ONLY from the structured `minAgeYears` /
   `maxAgeYears` fields; nothing SHALL be inferred from free-text criteria.
2. A usable bound SHALL be finite and within `[0, 150]`. A missing or non-finite
   bound SHALL produce no question for that bound.
3. WHEN `minAgeYears > maxAgeYears` (conflicting bounds), THE SYSTEM SHALL emit no
   age question at all.
4. Every age question SHALL have `kind: "inclusion"` and `ruleOutIf: "no"` (being
   outside the allowed range rules you out), and SHALL cite the structured bound
   (`minimumAge`/`maximumAge = N years`), verified against the study's actual value.

### Requirement 5 — Model authors prose only; shape + safety validation

**User story:** As the product, the plain-language prose comes from Amazon Bedrock
Nova, but the checklist does not.

#### Acceptance Criteria

1. THE SYSTEM SHALL ask the model for ONLY the prose fields (`summary`,
   `whatYouDo`, `timeCommitment`, `staff_checks`). It SHALL NOT ask the model to
   author questions, `ruleOutIf`, `kind`, or `source_criterion`.
2. THE SYSTEM SHALL call Bedrock via `@aws-sdk/client-bedrock-runtime`
   `ConverseCommand`, region from `AWS_REGION`, primary model from
   `BEDROCK_MODEL_ID` (expected `us.amazon.nova-2-lite-v1:0`), fallback from
   `BEDROCK_FALLBACK_MODEL_ID` (expected `us.amazon.nova-pro-v1:0`).
3. Auth SHALL be the bearer token the SDK auto-reads from
   `AWS_BEARER_TOKEN_BEDROCK` (signingName `bedrock`). The code SHALL NOT read, log,
   or embed the token value, and SHALL NEVER commit `.env.local`.
4. Upstream study text SHALL be passed as DATA inside a delimited, injection-safe
   block, never as instructions.
5. THE SYSTEM SHALL validate prose for SHAPE (required string fields) and SAFETY:
   forbidden phrases per language (rule 3), summary ≤ 80 words (rule 11), and
   preserved identifiers — no NCT id, phone, or email that is not in the source.

### Requirement 6 — Deterministic localized wording; bounded prose translation

**User story:** As a Spanish-speaking patient, I get the SAME checklist as English,
in faithful `usted`-register Spanish, with no translation able to flip the meaning.

#### Acceptance Criteria

1. Question wording SHALL come from handwritten, reviewed strings in the registry
   for the supported wording languages (`QUESTION_WORDING_LANGS = ["en", "es"]`).
2. WHEN the requested language has no deterministic wording (`pt, ht, zh, vi`), THE
   SYSTEM SHALL fail closed for the checklist and return a safe error.
3. For a supported non-English language, THE SYSTEM SHALL localize questions from
   the mapping's OWN wording and SHALL translate only the PROSE via the model.
4. A translated prose object SHALL be rejected if it introduces a number not in the
   English prose (`checkProseTranslationInvariants`). Translation SHALL NOT change
   disease type, negation, numbers, or age direction (the checklist it cannot
   touch; the prose it is number- and safety-checked).

### Requirement 7 — Semantic backstop (defense in depth)

**User story:** As an operator, even the server's own construction is re-verified
against the registry and the study's real facts before it ships.

#### Acceptance Criteria

1. `checkQuestionSemantics` SHALL verify each server-built question against the
   registry: a known mapping id; free-text `text` equal to the mapping wording for
   the language; `kind`/`ruleOutIf` equal to the mapping's fixed values; evidence
   present in the declared section; subject not mismatched; subject/evidence not
   staff-only; text not negated.
2. For age questions it SHALL verify `kind: "inclusion"`, `ruleOutIf: "no"`, a
   parseable age subject, a structured-age citation whose field and value match the
   study's actual bound.
3. WHEN any question disagrees, THE SYSTEM SHALL reject the whole model with a safe
   error (fail closed). This layer is expected never to fire in normal operation.

### Requirement 8 — Frontend contract fidelity

**User story:** As the frontend, the success body parses cleanly through
`parseSimplified`.

#### Acceptance Criteria

1. The success body SHALL include the fields `parseSimplified` requires:
   `whatItStudies` (mirrors `summary`), `whatYouDo` (string), and
   `questions: [{id, text, ruleOutIf: "yes"|"no"}]` with unique ids, plus
   `timeCommitment` and `lang`.
2. THE SYSTEM SHALL return `lang` equal to the requested language.
3. Additional rule-driven fields (`source_criterion`, `kind`, `staff_checks`) MAY
   be included and SHALL NOT break the parser.
4. IF implementing the contract would require editing `lib/simplify.ts` or
   `lib/types.ts`, the work SHALL stop and report an INTEGRATION REQUIREMENT
   instead of editing those files.

### Requirement 9 — Never claim eligibility; preserve protected values

#### Acceptance Criteria

1. The output SHALL never state or imply the user is eligible/qualifies/matches/is
   accepted. Validation SHALL reject prose containing any forbidden phrase in any
   supported language.
2. NCT IDs, phone numbers, and email addresses present in the source SHALL appear
   in the output byte-for-byte unchanged, or not at all — never reformatted or
   translated.

### Requirement 10 — Bounded timeouts, controlled fallback, safe failure

#### Acceptance Criteria

1. Every Bedrock call SHALL have a bounded per-call timeout (`PER_CALL_TIMEOUT_MS`)
   AND be bounded by a single shared deadline covering all Bedrock work
   (`BEDROCK_TOTAL_BUDGET_MS`). A call SHALL NOT start when less than `MIN_CALL_MS`
   remains.
2. The prose step SHALL retry at most once on the primary model and try the
   fallback model at most once; no unbounded loops.
3. WHEN all attempts fail, or the checklist cannot be built, THE SYSTEM SHALL return
   a safe error (non-2xx `{error}` body) compatible with the frontend's
   structured-check fallback — NEVER a fabricated summary or reassuring checklist.
4. The client abort/timeout SHALL be `>= SERVER_TOTAL_BUDGET_MS`
   (`CLIENT_TIMEOUT_FLOOR_MS`), so the client never gives up before the server's
   safe error.

### Requirement 11 — Cache successful results by (NCT id, lang)

#### Acceptance Criteria

1. THE SYSTEM SHALL cache a successful, validated result keyed by `(nctId, lang)`.
2. Different languages for the same NCT SHALL be cached separately.
3. THE SYSTEM SHALL NOT cache invalid output, errors, or fallback failures.

### Requirement 12 — SDK-free client boundary

#### Acceptance Criteria

1. `lib/bedrock.ts` SHALL be the ONLY module importing `@aws-sdk/*`. Budget
   constants the client needs SHALL live in `lib/simplify-budget.ts` (SDK-free).
2. Client components SHALL import `CLIENT_TIMEOUT_FLOOR_MS` from
   `lib/simplify-budget.ts` and SHALL NOT import `lib/bedrock` or any `@aws-sdk`
   module.

### Requirement 13 — Explicit pre-warm path, build/test safe

#### Acceptance Criteria

1. THE SYSTEM SHALL expose an explicit pre-warm function for the demo trials and
   languages from `docs/DEMO_DATA.md`.
2. Pre-warm SHALL NOT run automatically at import/build time and SHALL NOT be
   invoked by the automated test suite; it only runs when explicitly called.

### Requirement 14 — Tests (all mocked)

#### Acceptance Criteria

1. Focused tests SHALL cover: request validation; successful response; the
   server-built checklist (mapping selection, type-1/type-2 distinctness, section
   splitting, staff-only exclusion, `MIN_SUPPORTED_QUESTIONS` floor); structured-age
   construction; the semantic backstop; prose safety/translation invariants; retry
   and fallback limits; timeout/budget behavior; cache separation by language;
   identifier preservation.
2. The three review probes (`lib/review-semantic-bypass.test.ts`) and the production
   regressions (type-2-cites-type-1, age-cites-diagnosis, CCM-as-question) SHALL be
   permanent tests that fail closed.
3. Bedrock SHALL be mocked in every automated test; the suite makes NO live calls.

## Preserved guarantees

These hold unchanged from before the redesign:

- **Rule-11 summaries**: the prose summary names the hospital/site, says what
  participants do, includes the usual-care sentence when randomized, and always
  includes "Taking part is your choice." Summary ≤ 80 words.
- **Identifier integrity**: NCT ids, phones, and emails are preserved byte-for-byte
  and never introduced if absent from the source.
- **Bounded retries and a shared deadline** with named budget constants
  (`PER_CALL_TIMEOUT_MS`, `STUDY_LOAD_BUDGET_MS`, `BEDROCK_TOTAL_BUDGET_MS`,
  `MIN_CALL_MS`, `SERVER_TOTAL_BUDGET_MS`, `CLIENT_TIMEOUT_FLOOR_MS`).
- **Success-only caching** per `(nct, lang)`; invalid/failed results are never
  cached.
- **SDK-free client boundary**: `lib/simplify-budget.ts` carries the client
  constants; no client import of `lib/bedrock` or `@aws-sdk`.

## Limitations

This feature is **NOT general semantic validation across arbitrary studies**. It is
a scoped, fail-closed system:

- It is scoped to **NCT07043426** (the hero trial, THRIVE-DM at BMC) and whatever
  mappings exist in `lib/simplify-mappings.ts`. The supported free-text mappings at
  time of writing are T2DM diagnosis (inclusion), T1DM (exclusion), and hospice care
  (exclusion), plus the two structured-age mappings.
- **Languages that fail closed for the checklist**: `pt`, `ht`, `zh`, `vi`. Only
  `en` and `es` have reviewed deterministic question wording; other languages return
  a safe error rather than a machine-translated checklist.
- **Other studies fail closed** unless enough supported mappings apply to reach
  `MIN_SUPPORTED_QUESTIONS`. A study whose criteria use no explicit
  inclusion/exclusion headings, or whose supported facts are too few, returns a safe
  error and the frontend falls back.
- **Future expansion requires**, per added criterion or study: per-mapping clinical
  review; localized wording review for each supported language; more registry fact
  matchers; and clinician/editor sign-off before shipping. Adding a language's
  checklist wording requires its forbidden-phrase equivalents and a reviewed
  translation of every question first.
