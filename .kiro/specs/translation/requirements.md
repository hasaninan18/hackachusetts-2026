# Requirements — translation

## Introduction

The translation feature turns the plain-language trial card and the fit-check quick-check
questions from their English source into the four demo-scope non-English languages — Spanish
(`es`), Portuguese (`pt`), Haitian Creole (`ht`), and Simplified Chinese (`zh`). It caches a
translated result per `(NCT id, language)` so the demo is fast and cheap, preserves NCT IDs,
phone numbers, and email addresses verbatim through translation, labels every translated result
as machine-translated, and runs the forbidden-phrase check on each translation before it is
cached. It never produces an eligibility decision; it only restates the same plain-language card
and questions in another language.

This spec is grounded in the code that exists today:

- `lib/simplify.ts` — `parseSimplified(value, requestedLang, timeFallback)`, the pure parser for a
  `/api/simplify` response. It accepts both the `lib/types.ts` shape and the `docs/TASKS.md` shape
  (`{ summary, whatYouDo, questions: [{ id, text, rulesOut }] }`), normalizes to the `Simplified`
  type (`{ lang, whatItStudies, whatYouDo, timeCommitment, questions }`), carries the requested
  `lang` through when the payload omits or mis-types `lang`, and returns `null` on anything it can
  not trust (missing summary, question with no yes/no rule, duplicate ids). This is the one place
  a translated payload is turned into the card's data today.
- `lib/simplify.test.ts` — the behavioral contract already asserted for `parseSimplified`
  (accepts both payload shapes, maps `rulesOut` → `ruleOutIf` and numeric `id` → string, falls
  back `timeCommitment` to the supplied fallback, and rejects `null` / missing-summary /
  unruled-question / non-yes-no-rule / duplicate-id payloads).
- `lib/i18n/` — the UI-string translation layer. `en.ts` is the English source of every UI label
  (including `trial.*` card headings and `fit.*` quick-check labels); `dictionaries.ts` holds the
  per-language `Partial<Dictionary>` maps; `index.ts` exposes `getDictionary(lang)` (merges a
  language's partial over English so missing keys fall back to English), `LANG_NAMES`, `HTML_LANG`
  (Simplified Chinese is `zh-Hans`), `isLang`, `format`, and `translator`.
- `lib/phone.ts` — `telHref(phone)`, which turns a phone string into a `tel:` href while never
  altering the human-readable phone text; relevant here because phone numbers must survive
  translation unchanged (safety.md §5).
- `tests/copy-guard.mjs` — the forbidden-phrase and reading-grade checker. It exports
  `findForbiddenPhrase(text)` / `containsForbiddenPhrase(text)` (pure, total, case-insensitive,
  never throws on any string including non-Latin/empty) over a `FORBIDDEN` list that already
  carries the EN, ES, PT, HT, and ZH equivalents from safety.md §1. This is the forbidden-phrase
  check this spec requires on every translation.
- `.kiro/steering/safety.md` — the non-negotiable guardrails: §1 never claim eligibility and the
  per-language forbidden-phrase list, §2 ≤ 8th-grade reading level for English copy, §3 health
  answers stay in the browser, §4 always show contact + disclaimer, §5 preserve NCT IDs / phone
  numbers / emails verbatim, §6 scope boundaries, and the rule that a language's forbidden-phrase
  equivalents must exist before that language ships.

Terminology used below:
- **Translatable fields** — the four free-text fields of `Simplified` (`whatItStudies`,
  `whatYouDo`, `timeCommitment`) and each generated question's `text`. Structured values
  (`id`, `ruleOutIf`, `lang`) are not translated.
- **Supported translation language** — one of `es`, `pt`, `ht`, `zh`. English (`en`) is the source,
  not a translation target; Vietnamese (`vi`) is out of demo scope (see Requirement 8).
- **Preserved token** — an NCT id, phone number, or email address that must pass through
  translation byte-for-byte (safety.md §5).
- **Cache key** — the pair `(NCT id, language)` under which a translated `Simplified` result is
  stored and retrieved.

> Status note (existing-code gaps). This spec marks which behaviors the current code already
> satisfies and which are known gaps:
> - **Satisfied today:** `parseSimplified` already accepts and normalizes a non-English payload
>   (`lib/simplify.test.ts` parses an `es` payload), carries the requested language through, and
>   rejects untrusted shapes. The forbidden-phrase checker (`findForbiddenPhrase`) already covers
>   all four languages. The i18n UI layer already resolves `es`/`pt`/`ht`/`zh` dictionaries with
>   English fallback and sets `zh-Hans` for Simplified Chinese.
> - **Known gap — empty dictionaries:** `lib/i18n/dictionaries.ts` has `{}` for every language, so
>   the fit-check UI labels (`fit.*`) and card headings (`trial.*`) currently render in English for
>   `es`/`pt`/`ht`/`zh` (English fallback). Requirements about translated UI labels are gaps until
>   those maps are filled.
> - **Known gap — no translation call:** there is no code today that actually produces a
>   translation (no LLM/translation call, no `(NCT id, language)` cache, no machine-translated
>   label, and no forbidden-phrase gate invoked before caching). Requirements 1, 3, 4, 5, and 6
>   describe target behavior that is not yet implemented.

---

## Requirement 1 — Translate the card and quick-check questions into the four languages

**User story:** As a person who does not read English comfortably, I want the plain-language trial
card and the quick-check questions in my language, so that I can understand a study and self-assess
without English.

#### Acceptance Criteria

1. WHEN a translated card is requested for a trial in a supported translation language
   (`es`, `pt`, `ht`, `zh`), THEN the system SHALL produce the `Simplified` fields
   `whatItStudies`, `whatYouDo`, and `timeCommitment` in that language.
2. WHEN a translated card is requested, THEN the system SHALL produce the `text` of every generated
   quick-check question in that language.
3. WHEN a translated result is produced, THEN its `lang` field SHALL equal the requested language,
   and the result SHALL preserve the same question `id` values and the same `ruleOutIf` values as
   the English source (translation changes wording only, never the rule-out logic). *(Satisfied by
   `parseSimplified`, which keeps `id`/`ruleOutIf` and sets `lang`; the production of the
   translated text itself is a known gap.)*
4. WHEN the requested language is English (`en`), THEN the system SHALL return the source card
   unchanged and SHALL NOT mark it as machine-translated (English is the source, not a
   translation).
5. IF a translation payload cannot be trusted (missing summary, a question with no yes/no rule, or
   duplicate question ids), THEN the system SHALL reject it (return `null`) rather than show a
   partial or mislabeled card. *(Satisfied by `parseSimplified`.)*

## Requirement 2 — Translate the fit-check and card UI labels

**User story:** As a person reading the card in my language, I want the surrounding labels and
headings in my language too, so that the whole view reads in one language rather than switching
back to English.

#### Acceptance Criteria

1. WHEN the card and quick-check are shown in a supported translation language, THEN the system
   SHALL render the `trial.*` card headings and the `fit.*` quick-check labels in that language.
2. IF a UI string has no translation for the requested language, THEN the system SHALL fall back to
   the English source string for that key rather than show an empty label. *(Satisfied by
   `getDictionary`, which merges the language partial over English.)*
3. WHEN the view is rendered in Simplified Chinese, THEN the system SHALL set the document language
   to `zh-Hans`. *(Satisfied by `HTML_LANG`.)*
4. The per-language UI-label maps in `lib/i18n/dictionaries.ts` SHALL contain the translated
   `trial.*` and `fit.*` strings for `es`, `pt`, `ht`, and `zh`. *(Known gap: these maps are empty
   today, so these labels currently fall back to English.)*
5. WHEN a UI string carries a `{placeholder}` token, THEN its translation SHALL keep that token
   unchanged so `format()` can still fill it.

## Requirement 3 — Cache per `(NCT id, language)`

**User story:** As the demo operator, I want each trial's translation reused per language, so that
the demo is fast and does not re-translate on every view or exhaust API limits.

#### Acceptance Criteria

1. WHEN a translated card for a `(NCT id, language)` pair has already been produced, THEN the system
   SHALL return the cached result and SHALL NOT request the translation again. *(Known gap: no cache
   exists today.)*
2. WHEN no cached result exists for a `(NCT id, language)` pair, THEN the system SHALL produce the
   translation once and SHALL store it under that pair before returning it.
3. WHEN caching a translated result, THEN the system SHALL key it on both the NCT id and the
   language so that two languages for the same trial, or the same language across two trials, never
   collide.
4. WHEN a translated result is stored in the cache, THEN it SHALL have already passed the
   forbidden-phrase check (see Requirement 6) — an unchecked translation SHALL NOT be cached.
5. WHEN the cache is pre-warmed for the demo trials, THEN each pre-warmed `(NCT id, language)` entry
   SHALL be subject to the same preserve-tokens, machine-translated-label, and forbidden-phrase
   rules as an on-demand translation.

## Requirement 4 — Preserve NCT IDs, phone numbers, and emails verbatim (safety.md §5)

**User story:** As a person who needs to contact the study team, I want the study number, phone
number, and email to be exactly correct in every language, so that I reach the right study and the
right people.

#### Acceptance Criteria

1. WHEN any translatable field is translated, THEN the system SHALL preserve every NCT id
   (e.g. `NCT01234567`) in it byte-for-byte, with no translation, reformatting, or spacing change.
2. WHEN any translatable field is translated, THEN the system SHALL preserve every phone number in
   it byte-for-byte, so that `telHref()` produces the same `tel:` target from the translated text as
   from the source.
3. WHEN any translatable field is translated, THEN the system SHALL preserve every email address in
   it byte-for-byte.
4. WHEN a translated result is produced, THEN the set of NCT ids, phone numbers, and email addresses
   present in it SHALL be identical to the set present in the English source (none added, none
   dropped, none altered). *(Known gap: no translation step exists to enforce this yet; the
   invariant is the target.)*

## Requirement 5 — Label every translation as machine-translated

**User story:** As a user reading a translated study, I want to know the translation was done by a
machine, so that I weigh it accordingly and can confirm details with the study team.

#### Acceptance Criteria

1. WHEN a card or quick-check is shown in a supported translation language, THEN the system SHALL
   display a visible machine-translated label for that content.
2. WHEN content is shown in English (`en`), THEN the system SHALL NOT display a machine-translated
   label.
3. WHEN the machine-translated label is shown, THEN its own wording SHALL obey safety.md (no
   forbidden phrase, and the English label at or below an 8th-grade reading level).
4. WHEN a translated result is produced, THEN it SHALL carry a signal that it is machine-translated
   (so the UI can label it) rather than relying on the view to infer it from the language alone.
   *(Known gap: no such signal is produced today.)*

## Requirement 6 — Forbidden-phrase check on every translation before caching

**User story:** As a safety-conscious team, we want every translation screened for eligibility-claim
phrases in its own language before it is ever shown or cached, so that a machine translation can
not slip past the English-only guardrails.

#### Acceptance Criteria

1. WHEN a translation has been produced for a supported language, THEN the system SHALL run the
   forbidden-phrase check (`findForbiddenPhrase`) over every translatable field of the result —
   `whatItStudies`, `whatYouDo`, `timeCommitment`, and each question `text` — before the result is
   cached or shown. *(Satisfied: the checker exists and covers all four languages; Known gap: it is
   not yet invoked on translation output.)*
2. WHEN the forbidden-phrase check finds a phrase in any field of a translation, THEN the system
   SHALL treat the translation as failed, SHALL NOT cache it, and SHALL NOT show it as a translated
   card.
3. WHEN a translation fails the forbidden-phrase check, THEN the system SHALL fall back to a safe
   state — showing the content in English (or the structured quick-check only) — rather than showing
   the rejected translation.
4. WHEN the forbidden-phrase check runs, THEN it SHALL run against the cached/translated text for the
   requested language, NOT only the English source (safety.md §1).
5. WHEN the check is run over arbitrary translated text — including non-Latin script (Simplified
   Chinese), empty strings, or mixed-language strings — THEN it SHALL complete without throwing.
   *(Satisfied: `findForbiddenPhrase` is pure and total.)*

## Requirement 7 — Never claim eligibility, in any language (safety.md §1)

**User story:** As a user, I never want a translated study to tell me I am eligible or that I
qualify, because only the study team decides that.

#### Acceptance Criteria

1. The system SHALL NOT output any translated text that states or implies the person is eligible,
   qualifies, is a match, has been accepted, meets the criteria, is guaranteed, or is approved for
   the trial, in any supported language.
2. The system SHALL NOT cache or show any translated field containing a forbidden phrase from
   safety.md §1 in any supported language (enforced via Requirement 6).
3. WHEN a translation is shown, THEN the surrounding trial view SHALL still display the study's
   contact and the disclaimer "TrialPath is not medical advice. The study team decides eligibility."
   (safety.md §4), in the view's language where that copy is translatable.

## Requirement 8 — Supported languages gate (demo scope + safety.md ship rule)

**User story:** As a safety-conscious team, we want only languages whose guardrails are in place to
be translatable, so that we never ship a language the forbidden-phrase check can not screen.

#### Acceptance Criteria

1. The system SHALL treat exactly `es`, `pt`, `ht`, and `zh` as supported translation targets for
   the demo, with `en` as the untranslated source.
2. WHEN the Chinese option is presented to the user, THEN the system SHALL label it Simplified
   Chinese and SHALL NOT present a generic "Chinese" option.
3. IF a new translation language is added, THEN its forbidden-phrase equivalents SHALL exist in both
   `.kiro/steering/safety.md` §1 and the `tests/copy-guard.mjs` `FORBIDDEN` list BEFORE that
   language is offered as a translation target (safety.md ship rule).
4. WHILE Vietnamese (`vi`) lacks its forbidden-phrase equivalents, the system SHALL NOT offer `vi`
   as a translation target. *(Known gap aid: `vi` exists in the `Lang` union and `LANG_NAMES` but
   has no `FORBIDDEN` entries; it stays out of scope until those are added.)*

## Requirement 9 — Robust handling of untrusted translation payloads

**User story:** As a safety-conscious team, we want a bad or partial translation response to fail
safe, so that a flaky translation call never shows a broken or misleading card.

#### Acceptance Criteria

1. WHEN a translation payload is `null`, not an object, or missing a required field, THEN the system
   SHALL reject it and fall back to the English card rather than render a partial result.
   *(Satisfied by `parseSimplified` returning `null`.)*
2. WHEN a translation payload uses the `docs/TASKS.md` shape (`summary`, `whatYouDo`,
   `questions: [{ id, text, rulesOut }]`, no `timeCommitment`), THEN the system SHALL accept it,
   mapping `summary` → `whatItStudies`, `rulesOut` → `ruleOutIf`, numeric `id` → string, and filling
   `timeCommitment` from the supplied fallback. *(Satisfied by `parseSimplified`.)*
3. WHEN a translation payload omits or mis-types its `lang` field, THEN the system SHALL set the
   result's `lang` to the requested language. *(Satisfied by `parseSimplified`.)*
4. WHEN a translation call fails outright (network/timeout/service error), THEN the system SHALL
   fall back to the English card or the structured quick-check only, consistent with the
   LLM-failure fallback, and SHALL NOT block the trial view on the translation.
