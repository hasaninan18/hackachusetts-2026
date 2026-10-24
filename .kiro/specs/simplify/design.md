# Design — simplify

This document describes the **default-deny** redesign of `POST /api/simplify`. The
mapping table and behavior below are reported **as implemented at time of writing**
(`lib/simplify-mappings.ts`, `lib/simplify-semantics.ts`, `lib/bedrock.ts`,
`lib/bedrock-age.ts`, `lib/bedrock-types.ts`, `lib/simplify-budget.ts`,
`app/api/simplify/route.ts`); the code may still change.

## Why the design changed

The original pipeline was **default-allow**: the model authored each question and a
validator accepted it unless it matched a taught mistake. That design shipped a
semantically wrong checklist to production (see below) and was shown to accept
several review probes. The root cause was architectural, not a missing keyword:
trusting model-authored rule-out logic and only checking a cited quote as a
substring cannot establish that a question's subject, polarity, negation, or age
direction is correct. HTTP 200, green mocked tests, and substring matching proved
transport and shape, not meaning.

### Production incident (rolled back)

For NCT07043426 the production checklist asked "Do you have type 2 diabetes?" with
`kind: exclusion`, `ruleOutIf: yes`, citing "Patients with Type 1 Diabetes Mellitus
(T1DM)." — a type-2 question ruling you out on a type-1 exclusion. The age question
cited the diagnosis paragraph instead of structured bounds, and Complex Care
Management enrollment was asked as a question. Production rolled back to the prior
deployment without `/api/simplify`.

### Three accepted review probes

The old validator passed: (1) "Do you have asthma?" cited to T2DM; (2) "Do you NOT
have type 2 diabetes?" keeping the positive rule; (3) an age question citing
`minimumAge` with `kind: exclusion`/`ruleOutIf: yes`.

## Overview

Modules (pure logic in `lib/`, I/O in the route; `structure.md`):

- **`lib/simplify-mappings.ts`** (pure, SDK-free) — the DEFAULT-DENY registry.
  `splitSections` (the single authority on headings), `FREE_TEXT_MAPPINGS`,
  `AGE_MAPPINGS`, verbatim evidence extraction, `MIN_SUPPORTED_QUESTIONS`, and
  `buildChecklist`, which the server calls to construct the questions.
- **`lib/simplify-semantics.ts`** (pure, SDK-free) — the semantic BACKSTOP
  (`checkQuestionSemantics`) that re-verifies the server's own questions against the
  registry and the study's real facts, failing closed on any disagreement. Reuses
  `splitSections` as the heading authority.
- **`lib/bedrock-age.ts`** (pure, SDK-free) — structured-age citation detection and
  parsing (`isStructuredAgeCriterion`, `parseStructuredAgeCitation`).
- **`lib/bedrock-types.ts`** (pure, SDK-free) — `SimplifyQuestion`,
  `SimplifyProse`, `SimplifyModel`, `SimplifyBody`. The question type is server-owned.
- **`lib/simplify-budget.ts`** (pure, SDK-free) — the budget/timeout constants the
  client may import without pulling in the AWS SDK.
- **`lib/bedrock.ts`** — the ONLY module importing the AWS SDK. Prose prompts, prose
  validation, the Converse transport (`makeConverse`), the orchestrator
  (`generateSimplified`), the `(nct, lang)` result cache, and `prewarmDemo`.
  Re-exports the pure helpers and budget constants so existing imports are
  unaffected.
- **`app/api/simplify/route.ts`** — the I/O boundary: validate request, load the
  study through the upstream cache, call `generateSimplified`, cache, safe errors.

The Converse function and clock are injected into the orchestrator so tests mock
Bedrock with a plain function; the automated suite makes no live call.

## Design choice (a): the server builds the checklist

The model authors ONLY prose (`summary`, `whatYouDo`, `timeCommitment`,
`staff_checks`). The SERVER builds every question. Each mapping fixes, server-side
and immutably:

- the registry FACT it requires (a matcher over the study's verified criteria text
  in an unambiguous section, or a structured field);
- the SECTION it must live in (from explicit headings);
- `kind` and `ruleOutIf` (never from the model);
- the deterministic, handwritten patient-facing wording per supported language;
- the SOURCE evidence, extracted VERBATIM from the registry text by the server.

Anything not covered by a mapping is rejected (fail closed): unknown subjects,
unsupported wording, ambiguous evidence, compound/negated criteria without support,
quotes outside a clear section, or missing/ambiguous headings. Missing/ambiguous
headings never default to inclusion.

## Section splitting (the single heading authority)

`splitSections(criteriaText)` locates inclusion/exclusion slices using EXPLICIT
headings only (`/\binclusion\s+criteria\b/i`, `/\bexclusion\s+criteria\b/i`). It
returns a section only when:

- exactly one heading of that type is present (duplicates → null, ambiguous);
- if both are present, inclusion precedes exclusion (else null, ambiguous order);
- at least one usable heading exists (none → both null; it does NOT default to
  inclusion).

It returns both the normalized slice (for matching) and the raw slice (for verbatim
extraction). `simplify-semantics.ts` imports the same splitter so heading logic has
one source of truth.

## The mapping table (as implemented at time of writing)

For NCT07043426 (THRIVE-DM, BMC), the registry criteria and their disposition:

| Criterion (section) | Disposition | Reason |
| --- | --- | --- |
| Diagnosis: Type 2 Diabetes Mellitus (T2DM) (inclusion) | **SUPPORTED** → question `t2dm_diagnosis` | reviewed self-knowable inclusion fact |
| Uncontrolled T2DM: HbA1c ≥ 9% (inclusion) | NOT supported | precise lab value from record is not self-knowable → `staff_checks` (rules 7, 10) |
| Health-Related Social Needs: screened AND screened-positive during a GIM visit (inclusion) | NOT supported | compound + visit-type specific; no faithful single self-knowable yes/no → rejected |
| Complex Care Management (CCM) enrollment (exclusion) | staff-only | administrative; never a question (this was the production defect) |
| Hospice care (exclusion) | **SUPPORTED** → question `hospice` | self-knowable exclusion fact |
| Deceased (exclusion) | staff-only | not self-knowable / administrative |
| Type 1 Diabetes Mellitus (T1DM) (exclusion) | **SUPPORTED** → question `t1dm_exclusion` | self-knowable exclusion fact, kept strictly distinct from T2DM |

Free-text mappings as coded:

| id | section | evidenceMatch (normalized) | disqualifyIfAlsoMatches | ruleOutIf | en wording | es wording |
| --- | --- | --- | --- | --- | --- | --- |
| `t2dm_diagnosis` | inclusion | `type 2 diabetes mellitus (t2dm)` | `type 1 diabetes`, `t1dm` | `no` | Do you have type 2 diabetes? | ¿Tiene diabetes tipo 2? |
| `t1dm_exclusion` | exclusion | `type 1 diabetes mellitus (t1dm)` | `type 2 diabetes`, `t2dm` | `yes` | Do you have type 1 diabetes? | ¿Tiene diabetes tipo 1? |
| `hospice` | exclusion | `hospice care` | — | `yes` | Are you currently receiving hospice care? | ¿Está recibiendo cuidados de hospicio (hospice) actualmente? |

Age mappings (from structured bounds only):

| id | bound | kind | ruleOutIf | source_criterion | en wording | es wording |
| --- | --- | --- | --- | --- | --- | --- |
| `age_min` | min | inclusion | `no` | `minimumAge = N years` | Are you at least N years old? | ¿Tiene al menos N años? |
| `age_max` | max | inclusion | `no` | `maximumAge = N years` | Are you N years old or younger? | ¿Tiene N años o menos? |

`ruleOutIf` polarity: inclusion → `no` (failing it rules you out); exclusion →
`yes` (meeting it rules you out). The hero trial produces 4 questions (age-min,
T2DM, T1DM, hospice), above the floor.

## `buildChecklist(detail, lang)`

1. Fail closed if `lang` has no deterministic wording (`QUESTION_WORDING_LANGS`).
2. **Age**: from structured `minAgeYears`/`maxAgeYears`. A bound is usable only if
   finite and within `[0, 150]`. If `min > max`, emit no age question at all.
   Each usable bound yields `kind: "inclusion"`, `ruleOutIf: "no"`, and a
   server-formatted `minimumAge/maximumAge = N years` citation.
3. **Free-text**: for each mapping, require the `evidenceMatch` in the declared
   section; extract the single verbatim bullet line containing it (none/ambiguous →
   skip); skip if the matched line also carries a `disqualifyIfAlsoMatches` sibling
   (keeps T1/T2 distinct); otherwise push a question with `text` = the mapping's
   own wording, `kind` = the declared section, `ruleOutIf` = the mapping's fixed
   value, and the verbatim evidence.
4. Fail closed if fewer than `MIN_SUPPORTED_QUESTIONS` (2) questions; de-dupe ids.

## Internal model (`lib/bedrock-types.ts`)

```ts
interface SimplifyQuestion {       // SERVER-OWNED (not model-authored)
  id: string;
  text: string;
  ruleOutIf: "yes" | "no";
  source_criterion: string;
  kind: "inclusion" | "exclusion";
}
interface SimplifyProse {          // MODEL-AUTHORED
  summary: string;                 // ≤ 80 words, hospital + usual-care + choice
  whatYouDo: string;
  timeCommitment: string;
  staff_checks: string[];
}
interface SimplifyModel extends SimplifyProse { questions: SimplifyQuestion[]; }
interface SimplifyBody extends SimplifyModel { lang: Lang; whatItStudies: string; }
```

`whatItStudies` mirrors `summary`; the HTTP body is a superset of what
`parseSimplified` reads.

## Flow (`POST /api/simplify`)

```
parse body ──not json/obj──────────────────────────────▶ 400
validate nct (^NCT\d{8}$) & lang (LANGS) ──invalid─────▶ 400
cache (nct,lang) hit? ──yes────────────────────────────▶ 200 cached
load study: cachedFetchJson(nct, fetchStudies(buildDetailUrl(nct)))
  ├─ no study ───────────────────────────────────────▶ 404
  ├─ timeout (nothing cached) ───────────────────────▶ 504
  └─ other failure (nothing cached) ─────────────────▶ 502
toDetail(study) → { eligibility, briefSummary, contacts, title, … }
generateSimplified({ detail, lang, converse, budgetMs }):
  1) buildChecklist(detail,"en")      ── cannot build ─▶ safe error (503)
  2) buildChecklist(detail,lang)      ── unsupported ──▶ safe error (503)
  3) generateProse(EN): primary → retry once → fallback once, validate shape+safety
  4) assemble EN prose + EN questions; checkQuestionSemantics(EN) ── disagree ─▶ 503
  5) if lang==en → done
     else: translateProse(primary→retry→fallback), checkProseTranslationInvariants
           assemble translated prose + localized questions; backstop ── disagree ─▶ 503
success → cache.set((nct,lang), body) ─────────────────▶ 200 body
any failure ───────────────────────────────────────────▶ 503 {error} (frontend
                                                           falls back to its
                                                           structured quick-check)
```

The whole operation is bounded; `generateSimplified` always resolves within
`budgetMs` with a validated body or a safe error.

## Semantic backstop (`checkQuestionSemantics`)

Because questions are server-built, this never runs against model creativity; it is
a fail-closed assertion that construction stayed faithful. Per question:

- id must be a known mapping id (unknown → reject);
- text must not be negated (English + Spanish negation patterns);
- subject/evidence must not be staff-only;
- FREE-TEXT: `text` equals the mapping wording for the language; `kind`/`ruleOutIf`
  equal the mapping's fixed values; no diabetes T1/T2 subject mismatch; evidence
  present in the declared, unambiguous section; evidence polarity agrees with
  `kind`; `ruleOutIf` follows from polarity;
- AGE: `kind: "inclusion"`, `ruleOutIf: "no"`; a parseable age subject whose bound
  matches the mapping; a structured-age citation whose field and value match the
  study's actual bound.

Any disagreement rejects the whole model (safe error).

## Model prose prompts and translation

`buildEnglishProsePrompt` embeds the criteria text in a delimited, injection-safe
block and asks for the prose fields only, encoding rule-11 (hospital, usual-care
sentence when randomized, "Taking part is your choice."), identifier preservation,
and the forbidden-word rule. `validateProseOutput` parses, checks shape, forbidden
phrases per language, summary ≤ 80 words, and identifier integrity.

`buildProseTranslatePrompt` translates the VALIDATED English prose (usted for
Spanish), preserving identifiers. `checkProseTranslationInvariants` rejects a
translation that introduces a number absent from the English prose. The checklist is
never translated by the model — localized questions come from the mapping's own
handwritten wording — so translation cannot change disease type, negation, numbers,
or age direction.

## Bedrock auth finding (verified in the installed SDK)

`@aws-sdk/client-bedrock-runtime@3.1156.0`. `@aws-sdk/core`'s auth-scheme resolver
computes the bearer env key as `AWS_BEARER_TOKEN_${signingName.toUpperCase()}`;
bedrock-runtime's `signingName` is `"bedrock"`, so the key is
**`AWS_BEARER_TOKEN_BEDROCK`**, selected automatically when set. The code never reads
the token value.

## Budgets & bounds (`lib/simplify-budget.ts`, as implemented)

| Constant | Value | Covers |
| --- | --- | --- |
| `STUDY_LOAD_BUDGET_MS` | 1500 ms | ClinicalTrials.gov study load (enforced in the route) |
| `PER_CALL_TIMEOUT_MS` | 8000 ms | one Bedrock Converse call ceiling |
| `BEDROCK_TOTAL_BUDGET_MS` | 26000 ms | ALL Bedrock work (English + translate) via one shared deadline |
| `MIN_CALL_MS` | 250 ms | a call is not started if less than this remains |
| `SERVER_TOTAL_BUDGET_MS` | 27500 ms | = `STUDY_LOAD_BUDGET_MS` + `BEDROCK_TOTAL_BUDGET_MS` |
| `CLIENT_TIMEOUT_FLOOR_MS` | 30000 ms | = `SERVER_TOTAL_BUDGET_MS` + 2500 ms margin |

`generateSimplified` builds a single shared deadline from `budgetMs` (default
`BEDROCK_TOTAL_BUDGET_MS`) and an injectable `now`; each call gets
`min(PER_CALL_TIMEOUT_MS, time-left)` and is skipped once `< MIN_CALL_MS` remains. A
slow/hung model therefore returns 503 within budget, proven by fast mocked tests.

## SDK-free client boundary (verified)

`components/TrialPlain.tsx` imports `CLIENT_TIMEOUT_FLOOR_MS` from
`lib/simplify-budget.ts` (not `lib/bedrock`) and sets `TIMEOUT_MS =
CLIENT_TIMEOUT_FLOOR_MS`. No client component imports `lib/bedrock` or `@aws-sdk`
(verified by grep at time of writing). On a non-2xx response the client settles into
its `failed` state and shows its own structured quick-check — the cautious fallback.

### INTEGRATION REQUIREMENT — client timeout coordination

The client abort/timeout must be `>= SERVER_TOTAL_BUDGET_MS`. The client imports
`CLIENT_TIMEOUT_FLOOR_MS` directly, so the two stay in lockstep. `30000 >= 27500`
holds. This no longer duplicates a literal; if the server budget is raised, the
client inherits it. (`components/TrialPlain.tsx` is not owned by this spec; the SDK-
free import is the sanctioned coupling.)

## Error mapping

- `400` invalid request · `404` no study · `502` upstream fail · `504` upstream
  timeout · `503` checklist-unbuildable / Bedrock unavailable / backstop rejection.
  All bodies `{error}`.

## Testing strategy

- Pure tests: `splitSections` (ambiguous/duplicate/ordering → null; no default to
  inclusion), `buildChecklist` (mapping selection, T1/T2 distinctness, staff-only
  exclusion, structured-age, conflicting bounds, `MIN_SUPPORTED_QUESTIONS`),
  `checkQuestionSemantics` (every reject branch), `bedrock-age` parsing, prose
  validation and translation invariants.
- Permanent fail-closed probes: `lib/review-semantic-bypass.test.ts` (asthma-on-
  diabetes, negated question, wrong age polarity) and the production regressions
  (type-2-cites-type-1, age-cites-diagnosis, CCM-as-question).
- Route tests (fetch + converse mocked): validation 400s, 404/502/504, success 200
  with contract fields + preserved identifiers, retry→success, exhaustion→503,
  timeout/budget→503, cache separation by language, no-cache-on-failure.
- Live EN/ES inspection (manual, not in the mocked suite): record every question,
  evidence, `kind`, `ruleOutIf`, and latency, or the safe-rejection reason, before
  production restoration.
