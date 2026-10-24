# Tasks — translation

Tasks the existing code already satisfies are marked `[x]` with the file that satisfies them.
Open tasks are grouped by owner per `.kiro/steering/structure.md`:
- **Hasan** owns `app/api/**`, `lib/clinicaltrials.ts`, `lib/mbta.ts`, `lib/bedrock.ts`, and
  `lib/simplify.ts` (API-facing `lib/*`).
- **Neil** owns `app/[lang]/**`, `components/**`, `lib/types.ts`, `lib/i18n/**`.
- **Akash** owns `.kiro/**`, `tests/**`, `README.md`, `KIRO_LOG.md`.

Nothing in `lib/`, `app/`, or `components/` is edited by this spec — the open tasks below are the
handoff. The exact drafts (token preservation, Bedrock call, cache + gate, the `machineTranslated`
flag) are in `design.md` → "Proposed change for the owner".

---

## Already satisfied by existing code

- [x] 1. Parse + normalize a non-English `/api/simplify` payload into `Simplified`
  - `lib/simplify.ts` `parseSimplified`; `lib/simplify.test.ts` parses an `es` payload unchanged and the `docs/TASKS.md` shape.
  - _Requirements: 1.3 (keeps id/ruleOutIf, sets lang), 9.2_
- [x] 2. Carry the requested language through when the payload omits/mis-types `lang`
  - `lib/simplify.ts` (`LANGS.includes(s.lang) ? s.lang : requestedLang`).
  - _Requirements: 1.3, 9.3_
- [x] 3. Reject untrusted translation payloads (null, no summary, unruled question, duplicate ids)
  - `lib/simplify.ts` returns `null`; `lib/simplify.test.ts` ("rejects ...").
  - _Requirements: 1.5, 9.1_
- [x] 4. Forbidden-phrase checker covering en/es/pt/ht/zh, pure + total, never throws
  - `tests/copy-guard.mjs` `findForbiddenPhrase` / `containsForbiddenPhrase` + `ALL_FORBIDDEN`.
  - _Requirements: 6.1 (checker exists), 6.5_
- [x] 5. Phone numbers map to the same `tel:` target without altering the visible number
  - `lib/phone.ts` `telHref`; `lib/phone.test.ts`.
  - _Requirements: 4.2 (checker side — restoration still owed by the translate step)_
- [x] 6. Resolve es/pt/ht/zh UI dictionary with English fallback
  - `lib/i18n/index.ts` `getDictionary` merges the language partial over English.
  - _Requirements: 2.2_
- [x] 7. `zh-Hans` for Simplified Chinese; Simplified-Chinese language label
  - `lib/i18n/index.ts` `HTML_LANG.zh = "zh-Hans"`, `LANG_NAMES`.
  - _Requirements: 2.3, 8.2_
- [x] 8. Supported-language set defined; `vi` present in union but out of demo scope
  - `lib/types.ts` `LANGS`; `tests/copy-guard.mjs` `FORBIDDEN` has es/pt/ht/zh (no `vi`).
  - _Requirements: 8.1, 8.4_

---

## Open — Hasan (owns `app/api/**`, `lib/bedrock.ts`, `lib/simplify.ts`)

- [ ] H1. Token preservation helper (mask → translate → restore → verify)
  - File: `lib/preserveTokens.ts` + co-located `lib/preserveTokens.test.ts` (design Draft 1).
    `maskTokens`/`restoreTokens`/`verifyTokens` over NCT ids, emails, phones; `verifyTokens`
    returns false if any identifier set differs. Pure, no I/O.
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
- [ ] H2. Bedrock translate call (Converse, primary → fallback model)
  - File: `lib/bedrock.ts` (design Draft 2). `translateSimplified(src, lang)` translates every
    translatable field; uses the tech.md env vars (`AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`=us-east-2,
    `BEDROCK_MODEL_ID`=`us.amazon.nova-2-lite-v1:0`, `BEDROCK_FALLBACK_MODEL_ID`=`us.amazon.nova-pro-v1:0`).
    No Claude IDs. Throws on token mismatch / unreachable so the route can fall back.
  - _Requirements: 1.1, 1.2, 4.4, 9.4_
- [ ] H3. `/api/simplify` route: cache per `(NCT id, language)` + forbidden-phrase gate before caching
  - File: `app/api/simplify/route.ts` (design Draft 3). Key `${nctId}:${lang}`; only a screened
    result is cached; English returns unlabelled; miss → translate → `parseSimplified` → `screen()`
    → cache. On any failure fall back to the English card.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 9.4_
- [ ] H4. Thin re-export of the forbidden-phrase logic for route code
  - File: `lib/forbidden.ts` (design Draft 3 note) — re-export `findForbiddenPhrase`/`ALL_FORBIDDEN`
    from the copy-guard logic so `app/api/**` imports it without reaching into `tests/`. Keeps the
    phrase list single-sourced with safety.md §1.
  - _Requirements: 6.1, 6.4, 8.3_
- [ ] H5. Pre-warm the demo trials' cache (5–10 NCT ids × es/pt/ht/zh)
  - File: `app/api/simplify/route.ts` or a small warm script (Hasan). Each pre-warmed entry goes
    through the same mask/restore/verify + screen-before-cache path.
  - _Requirements: 3.5_

## Open — Neil (owns `lib/types.ts`, `lib/i18n/**`, `components/**`)

- [ ] N1. Add the `machineTranslated` flag to `Simplified`
  - File: `lib/types.ts` (design Draft 4) — optional `machineTranslated?: boolean`. English source
    is `false`/absent; a screened translation is `true`.
  - _Requirements: 5.4_
- [ ] N2. Render a visible machine-translated badge on the card
  - File: `components/TrialPlain.tsx` (design Draft 4) — show the badge only when
    `simplified.machineTranslated` is true; hidden for English.
  - _Requirements: 5.1, 5.2_
- [ ] N3. Add the badge i18n key (≤ 8th grade, no forbidden phrases)
  - File: `lib/i18n/en.ts` — e.g. `"trial.machineTranslated"`; run copy-guard on the new string.
  - _Requirements: 5.3_
- [ ] N4. Fill the es/pt/ht/zh UI dictionaries for `trial.*` / `fit.*` (+ the badge key)
  - File: `lib/i18n/dictionaries.ts` (design Draft 5). Keep every `{placeholder}` unchanged; screen
    the translated strings with copy-guard before shipping (not just English).
  - _Requirements: 2.1, 2.4, 2.5, 6.4_
- [ ] N5. Keep the disclaimer + contact visible on the translated view (safety.md §4)
  - Files: `components/ContactCard.tsx` / the trial view (Neil) — unchanged behavior, confirmed for
    the translated card.
  - _Requirements: 7.3_

## Open — Akash (owns `.kiro/**`, `tests/**`, `KIRO_LOG.md`)

- [ ] A1. Cross-cutting property tests for token preservation + screen-before-cache
  - File: `tests/translation.property.test.ts` — (a) for arbitrary text, `restoreTokens` after
    `maskTokens` round-trips every NCT/phone/email and `verifyTokens(src, restored)` holds; altering
    any token makes `verifyTokens` fail; (b) a translated field containing a forbidden phrase is
    never cached/shown (the `screen()` gate rejects it).
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.2, 6.3_
- [x] A2. Requirements + design authored, with Known gaps and a Proposed-change section
  - Files: `.kiro/specs/translation/requirements.md`, `.kiro/specs/translation/design.md`.
  - _Requirements: all_
- [ ] A3. Add Vietnamese forbidden-phrase equivalents BEFORE `vi` ships (if `vi` is added)
  - Files: `.kiro/steering/safety.md` §1 + `tests/copy-guard.mjs` `FORBIDDEN.vi`. Gates Req 8.3/8.4;
    not needed for the es/pt/ht/zh demo scope.
  - _Requirements: 8.3, 8.4_
- [ ] A4. After Hasan's + Neil's PRs merge, record the outcome in `KIRO_LOG.md`
  - File: `KIRO_LOG.md` — note what shipped (translate call, cache, flag, gate) and only what was
    observed.
  - _Requirements: all_
