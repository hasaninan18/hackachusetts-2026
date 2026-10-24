# Design — simplify

## Overview

Two layers, following `structure.md` (pure logic in `lib/`, I/O in routes):

- **`lib/bedrock.ts`** — the only module that imports the AWS SDK and does Bedrock
  I/O. Also holds the pure prompt-building, output-validation, translation-prompt,
  and `(nct, lang)` result-cache helpers, plus the explicit pre-warm entry point.
  The pure helpers (prompt строки, validator, protected-value extraction) are
  exported for direct unit testing without touching the network.
- **`app/api/simplify/route.ts`** — the I/O boundary: validate request, load the
  study through the existing upstream cache, orchestrate English-first generation,
  translation, cache, and safe errors.

The SDK client, `ConverseCommand`, and the per-call clock/timeout are **injected**
into the orchestrator so tests mock Bedrock with a plain function and assert
retry/fallback/timeout behavior deterministically — no `vi.mock` of the transport
is required, though tests may also mock the SDK module directly.

## Frontend contract (verified, not assumed)

`lib/simplify.ts#parseSimplified(value, requestedLang, timeFallback)` accepts:

- `whatItStudies` **or** `summary` → non-empty string (maps to "what it studies")
- `whatYouDo` → non-empty string (required)
- `questions` → array of `{ id, text, ruleOutIf | rulesOut: "yes"|"no" }`,
  ids coerced from number, **must be unique**, at least one
- `timeCommitment` → optional string (falls back to a caller-supplied default)
- `lang` → optional; parser falls back to `requestedLang`

Unknown fields are ignored by the parser. **Decision:** the route returns
`whatItStudies`, `whatYouDo`, `questions[].{id,text,ruleOutIf}`, `timeCommitment`,
and `lang` as the contract-bearing fields, and ADDITIONALLY carries rule-driven
fields (`summary` mirrors `whatItStudies`; each question keeps `source_criterion`
and `kind`; a top-level `staff_checks: string[]`) for richness and for the safety
validator. No `lib/simplify.ts` / `lib/types.ts` change is required — so there is
**no INTEGRATION REQUIREMENT** for the contract. (Reported as such in the final
message.)

## Internal model

The model is asked for a RICHER structure than the frontend consumes, so the
15 rules can be validated. Internal English object:

```ts
interface SimplifyModel {
  summary: string;            // ≤ 80 words, names hospital, usual-care + choice lines
  whatYouDo: string;          // what participants do
  timeCommitment: string;     // visit cadence / duration in plain words
  questions: Array<{
    id: string;
    text: string;             // ≤ 20 words, one fact
    ruleOutIf: "yes" | "no";
    source_criterion: string; // quoted substring of criteria text
    kind: "inclusion" | "exclusion";
  }>;                         // 3–6, unique ids, ordered most→least ruling-out
  staff_checks: string[];     // non-self-knowable / administrative items
}
```

The HTTP success body is this object plus `whatItStudies = summary` and
`lang = requested`, which is a superset of the parser's contract.

## Flow (`POST /api/simplify`)

```
parse body ──not json/obj──────────────────────────────▶ 400
  │
validate nct (^NCT\d{8}$) & lang (LANGS) ──invalid─────▶ 400
  │
cache (nct,lang) hit? ──yes────────────────────────────▶ 200 cached
  │ no
load study: cachedFetchJson(nct, fetchStudies(buildDetailUrl(nct)))
  ├─ no study ───────────────────────────────────────▶ 404
  ├─ timeout (nothing cached) ───────────────────────▶ 504
  └─ other failure (nothing cached) ─────────────────▶ 502
  │
toDetail(study) → { eligibility, briefSummary, contacts, title, … }
  │
generateEnglish(detail):                 ── Requirement 7 ──
  attempt 1: converse(primary, EN prompt, timeout)
    → parse+validate(shape+safety) ─ ok ─▶ english
    → invalid → attempt 2 (bounded retry, same model, stricter reminder)
       → invalid → converse(fallback model) once
          → invalid → FAIL
  │ english ok
if lang == "en": result = english
else: translate(english, lang):          ── Requirement 7.1 / rule 14 ──
  converse(primary, TRANSLATE prompt carrying english JSON, timeout)
    → parse+validate(shape+safety, same ids/structure, identifiers preserved)
    → invalid → retry once → fallback model once → FAIL
  │
success → cache.set((nct,lang), body) ─────────────────▶ 200 body
any Bedrock FAIL ──────────────────────────────────────▶ 503 {error} (safe,
                                                           frontend falls back to
                                                           structured quick-check)
```

Caching is enforced before load so a warm result skips both the upstream and
Bedrock. Invalid/failed results are never cached (Requirement 9.3).

## `lib/bedrock.ts` — exports

Pure (no I/O, unit-testable):
- `SUPPORTED_LANGS` — re-export of `LANGS`.
- `parseNct(raw): string | null` — trims, upper-cases, matches `^NCT\d{8}$`.
- `buildEnglishPrompt(detail): { system: string; user: string }` — embeds criteria
  text inside a delimited, injection-safe data block; encodes rules 2–13, 15; and
  includes the structured age bounds so the age question is rule-6 compliant.
- `buildTranslatePrompt(englishJson, lang): { system, user }` — rule 14; "translate
  this JSON, keep the same ids and structure, usted register for Spanish, preserve
  NCT IDs / phones / emails verbatim".
- `extractProtectedValues(text): { ncts, phones, emails }` — regex extraction.
- `validateModelOutput(raw, { lang, protectedFromSource }): { ok; value?; error? }`
  — JSON parse + shape + safety (forbidden phrases per language, ≤80-word summary,
  3–6 unique-id questions, each `source_criterion` a substring of the criteria,
  identifiers preserved/unchanged). Returns a typed result, never throws.
- `toResponseBody(model, lang)` — adds `whatItStudies`, `lang`.
- `FORBIDDEN_PHRASES` — English list from `safety.md` rule 3 plus per-language
  equivalents (es/pt/ht/zh; vi marked and included once copy is set).

I/O (injectable, mocked in tests):
- `type Converse = (modelId: string, prompt: {system,user}, signal) => Promise<string>`
- `makeConverse(client?): Converse` — builds a `BedrockRuntimeClient` (region from
  `AWS_REGION`; bearer token auto-read from `AWS_BEARER_TOKEN_BEDROCK`) and runs
  `ConverseCommand`, returning the first output text block.
- `generateSimplified({ detail, lang, converse, now, timeoutMs })` — the
  orchestrator above; returns `{ ok; body?; error?; status? }`.
- Result cache: `getSimplifyCached(nct, lang)`, `setSimplifyCached(nct, lang, body)`,
  keyed `${nct}::${lang}` in a module `Map` (separate from the upstream cache).
- `prewarmDemo({ converse })` — iterates the DEMO_DATA trials × languages and
  populates the result cache; **never called at import time**, guarded so it is a
  no-op unless given a real `converse`.

## Bedrock auth finding (verified in the installed SDK)

`@aws-sdk/client-bedrock-runtime@3.1156.0`. `@aws-sdk/core`'s auth-scheme resolver
computes the bearer env key as `AWS_BEARER_TOKEN_${signingName.toUpperCase()}`;
bedrock-runtime's `signingName` is `"bedrock"`, so the key is
**`AWS_BEARER_TOKEN_BEDROCK`**, and when that env var is set the resolver selects
`httpBearerAuth` automatically. No manual credential wiring is needed. The code
never reads the token value itself.

## Timeouts & bounds

- One `AbortController` per Bedrock call; default `timeoutMs` ~12s (overridable,
  tests pass a tiny value / a rejecting converse to exercise the timeout path).
- Per language request: at most 2 English attempts (retry) + 1 fallback-model
  attempt, and for non-English the same bound on the translate step. No unbounded
  loops.

## Error mapping

- `400` invalid request · `404` no study · `502` upstream fail · `504` upstream
  timeout · `503` Bedrock unavailable / validation exhausted. All bodies `{error}`.

## Testing strategy

`lib/bedrock.test.ts` (pure): `parseNct`, `validateModelOutput`
(valid / forbidden-phrase / wrong count / bad enum / mutated identifier /
over-long summary / non-substring source_criterion), `extractProtectedValues`,
prompt builders embed the data block and never leak instructions, `FORBIDDEN_PHRASES`
cover each language.

`app/api/simplify/route.test.ts` (route, fetch + converse mocked): validation
400s, 404, success 200 with contract fields + preserved NCT/phone/email, malformed
model output → retry then success, both-attempts-bad + fallback-bad → 503,
converse timeout → 503, cache separation (en vs es hit independently; a second
call with the same key does not re-invoke converse), no-caching-on-failure.

## Bounded total request budget (Task 1 — hardening)

`POST /api/simplify` must ALWAYS answer within a known wall-clock bound with either a
validated body or a safe `{error}` — it must never hang. A single TOTAL budget covers the
whole operation (study load + Bedrock primary + retry + fallback + translation), not just a
per-call timeout.

Named constants (exported from `lib/bedrock.ts`):

| Constant | Value | Covers |
| --- | --- | --- |
| `STUDY_LOAD_BUDGET_MS` | 1500 ms | ClinicalTrials.gov study load (enforced in the route) |
| `PER_CALL_TIMEOUT_MS` | 2000 ms | one Bedrock Converse call ceiling |
| `BEDROCK_TOTAL_BUDGET_MS` | 7000 ms | ALL Bedrock work (English + translate) via one shared deadline |
| `MIN_CALL_MS` | 250 ms | a call is not started if less than this remains |
| `SERVER_TOTAL_BUDGET_MS` | 8500 ms | = `STUDY_LOAD_BUDGET_MS` + `BEDROCK_TOTAL_BUDGET_MS` |
| `CLIENT_TIMEOUT_FLOOR_MS` | 10000 ms | minimum client abort/timeout = server total + 1500 ms margin |

Budget math (each phase bounded; they sum to the total):

```
study load .................................... STUDY_LOAD_BUDGET_MS    = 1500 ms
English:  primary + retry + fallback .......... 3 calls, each ≤ PER_CALL_TIMEOUT_MS
translate: primary + retry + fallback ......... 3 calls, each ≤ PER_CALL_TIMEOUT_MS
   → the SUM of all Bedrock work is capped at BEDROCK_TOTAL_BUDGET_MS = 7000 ms by a
     single shared deadline (each call gets min(PER_CALL_TIMEOUT_MS, time-left); a call
     is skipped once < MIN_CALL_MS remains).
---------------------------------------------------------------------------------------
SERVER_TOTAL_BUDGET_MS = 1500 + 7000 = 8500 ms
```

`generateSimplified` takes `budgetMs` (defaults to `BEDROCK_TOTAL_BUDGET_MS`) and an
injectable `now` clock, builds a deadline, and bounds EVERY Converse call by it. Once the
budget is spent the next attempt is aborted/skipped and the pipeline returns its safe error,
so the route returns 503 within budget on a slow/hung model — proven by a mocked, fast test
(tiny `budgetMs`/`timeoutMs`, no real waiting, no live Bedrock).

### INTEGRATION REQUIREMENT — coordinate the client timeout

The client abort/timeout MUST be `>= SERVER_TOTAL_BUDGET_MS` so the client never gives up
before the server returns its safe error. The client timeout lives in
`components/TrialPlain.tsx` (`const TIMEOUT_MS = 10_000;`), a file this spec does NOT own.

- Current client value: `10_000` ms.
- Required floor: `CLIENT_TIMEOUT_FLOOR_MS` = `10_000` ms (exported from `lib/bedrock.ts`).
- Action: `10_000 >= 10_000` holds, so the current value is acceptable. To remove the
  duplicated literal and keep the two in lockstep, import the constant:
  `import { CLIENT_TIMEOUT_FLOOR_MS } from "../lib/bedrock";` and set
  `const TIMEOUT_MS = CLIENT_TIMEOUT_FLOOR_MS;`. If the server budget is ever raised,
  the client must not drop below it.

## Translation invariants (Task 2)

The validated ENGLISH JSON is the structural source of truth. `checkTranslationInvariants`
rejects any translation that changes the number of questions, reorders them, renames an
`id`, or alters `ruleOutIf` or `kind`. The translation step may only change human-readable
text. A rejected translation re-enters the existing bounded retry/fallback path; if all
attempts fail the route returns a safe 503.

## source_criterion grounding + structured age bounds (Task 3)

`source_criterion` stays the ORIGINAL English quoted evidence — never translated or
paraphrased (also enforced by `checkTranslationInvariants`, which requires the translated
`source_criterion` to equal the English one). `checkSourceCriteria` validates each quote
against the study's eligibility criteria text (whitespace/case normalized); a fabricated or
materially altered quote is rejected. EXPLICIT exception: a `source_criterion` derived from
the STRUCTURED age fields (`minimumAge`/`maximumAge`) — recognized by markers like
`minimumAge`/`maximumAge`/`structured age bounds` — is validated against those structured
values instead of requiring a verbatim free-text match, so a legitimate age question is not
wrongly rejected. If the study has no structured age bounds, such a citation is rejected.
