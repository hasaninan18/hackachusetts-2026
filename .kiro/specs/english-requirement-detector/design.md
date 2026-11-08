# Design — english-requirement-detector

## Overview

One new pure module, `lib/english-requirement.ts`, exporting `detectEnglishRequirement`
plus the `EnglishRequirement` and `NotRequiredReason` types. It reuses `splitSections`,
`sectionLines` and `normalizeLine` from `lib/simplify-mappings.ts` (read-only reuse; that
module is not edited). No other file imports the detector yet.

**Server-only.** `lib/simplify-mappings.ts` imports `node:crypto`, so the detector must not
be imported from any `"use client"` file. It is not wired to any route or component here.

## Pipeline

```
criteriaText
  │  coerce non-string → ""
  ├─ no /\benglish\b/i anywhere ───────────────────────────► none / no-mention
  │
  ├─ splitSections()  (the single heading authority)
  │    inclusionRaw = exclusionRaw = null ────────────────► mentioned / no-sections
  │
  ├─ whole text split on newlines (no heading logic), normalizeLine each;
  │    any English line is a veto (steps 1–3 below) ────────► mentioned / other-language-allowed
  │
  ├─ sectionLines(inclusionRaw) tagged "inclusion",
  │  sectionLines(exclusionRaw) tagged "exclusion"   (document order)
  │    keep lines whose .normalized has whole-word "english"
  │    none kept (English only outside sections) ────────► mentioned / unclear
  │
  ├─ classify every English line (table below)
  │
  └─ decide, in strict precedence:
       1. any veto            → mentioned / other-language-allowed (already caught above)
       2. any unclear         → mentioned / unclear
       3. any requirement     → required, evidence = originals in order
       4. only subject lines  → mentioned / not-about-patient
```

Vetoes are evaluated over the whole study before anything else, so one veto line anywhere
cancels every requirement line, and a veto that appears after an earlier unclear line
still wins (reason `other-language-allowed`). "Anywhere" includes text before the first
heading: the veto scan runs on a plain newline split of the whole text, while requirement
lines and evidence still come only from `sectionLines()`.

## Line classification

Each English line's `normalized` form (bullet stripped, whitespace collapsed, lower-cased by
`normalizeLine`) is tested in this order; the first match wins:

| Step | Test | Class |
|---|---|---|
| 1 | names another language, plural "languages", "any/preferred/sign language", bilingual | veto |
| 2 | `interpret*` or `translat*` | veto |
| 3 | welcome / allowed / permitted / eligible / "will not be excluded" / "may join" / "may participate" / "may be included" / "not required"; hedges: preferred / preferably / ideally / encouraged / "if possible" / unless / except / accommodat* | veto |
| 4 | names a non-patient subject (parent, caregiver, guardian, clinician, staff, provider, partner, proxy, doula, family, father, mother, teacher, coach, spouse, physician, nurse, …) | subject |
| 5 | no clause has a language-ability word within 10 tokens of "english" (speak/speaking/speaker, read, write, understand, comprehend, fluent, proficient/proficiency, literate/literacy/illiterate, converse/conversing, communicate) and no clause says "other than english"; "able"/"ability", "written", "consent" and bare "language" are deliberately not ability words | unclear |
| 6 | inclusion: no negation token anywhere on the line | requirement |
| 7 | exclusion: some clause has a negation BOUND to "english" or to an in-scope ability word | requirement |
| 8 | otherwise (inclusion with any negation, or exclusion without a bound negation) | unclear |

**Clauses and tokens.** The normalized line is split into clauses at `.`, `;`, `!` or `?`
followed by a space or the end, and each clause into word tokens (letters, digits,
apostrophes; "non-english" is the two tokens `non`, `english`). Ability and negation are
only ever combined within one clause.

**Negation tokens:** `not`, `no`, `non`, `unable`, `inability`, `cannot`, `lack*`, `poor`,
`poorly`, `limited`, `insufficient`, `inadequate`, `without`, `never`, `neither`, `nor`, any
`…n't`, and the inability words `illiterate`, `illiteracy`, `nonfluent`, `nonenglish`;
plus the phrase `other than english`. "other than English" only acts as negation after step 1
has already ruled out a named second language, so "Primary language other than English or
Spanish" is a veto and "Language other than English" is an exclusion requirement.

**Bound negation (exclusion only).** A negation token is bound when it:
- is itself an in-scope ability word (`illiterate in english`); or
- comes at most **2** tokens BEFORE "english" or an in-scope ability word, with none of
  `with who whom whose which that and or but if when while because for` in between
  (`unable to speak`, `not proficient in`, `non english`, `inability to comprehend`); or
- comes directly AFTER one, or after one copula (`is are was were be been`), and is one of
  `not limited poor insufficient inadequate lacking …n't` (`english proficiency is limited`).
  `no` / `without` after English start a new phrase and never bind.

Inclusion is deliberately left stricter: ANY negation token anywhere on the line makes it
unclear. That also keeps R10.4 (Inclusion↔Exclusion swap) true by construction, because
every bound negation is also a negation anywhere.

**Windows.** 10 (ability ↔ english) is the smallest that keeps fixture `real-line-05`
("Ability to understand and provide a signed and completed consent document in English":
`understand` … `english` = 10 tokens). 2 (negation → target) is the smallest that keeps
`unable to speak`, `unable to read or write` and `inability to comprehend`. Both only move
results away from `required` compared with the previous unscoped rules.

All regexes are anchored on `\b` word boundaries and use no nested quantifiers, and the
clause checks use a two-pass nearest-"english" distance plus fixed-size neighbourhoods, so the
whole detector is linear in the input length (the ≥ 50,000-character tests and a 300,000+
character single-line test guard this).

### Why step 5 exists (design addition to the contract)

A literal reading of contract R2.4 makes every inclusion English line without a negation a
requirement. Fixture `real-line-30` (`no-flag`) is exactly that: "Lives in an environment
where child is exposed to English at least 50% of the time". It describes exposure, not the
patient's ability, and must not flag. Step 5 sends any English line that states no language
ability to `unclear`. All 16 `flag` fixtures carry an ability cue, so the addition costs no
asserted recall. The first implementation omitted step 5 and failed this fixture (plus
related behavior tests); see tasks.md task 4.

The cue list is narrow on purpose. "Written" ("materials are written in English"),
"consent" ("consent forms are available in English") and a bare "language" ("English-language
materials") describe documents, not the patient, so they do not count. Real consent
requirements still flag through "able"/"ability"/"understand" (fixture `real-line-05`).

## Fixture walk-through (by hand, then confirmed by the test run)

- Inclusion requirements: `English speaking`, `English-speaking`, `Must be able to read, speak
  and understand English`, `…consent document in English.`, `English proficiency sufficient
  …`, `Comfortable conversing in English`, `MUST SPEAK ENGLISH`.
- Exclusion requirements via negation: `Unable to…`, `Non-English speaking…`, `Not
  proficient…`, `Inability to comprehend…`, `No individuals who are not proficient…`;
  via "other than": `Language other than English`.
- Vetoes: every English-or-X line, interpreter/translation lines, "eligible", "still
  eligible", "will not be excluded", "may join", "is not required", "welcome".
- Subject: clinician / parent / caregiver lines → `not-about-patient`.
- No-sections: no heading, duplicate heading, multi-cohort headings, and the merged-heading
  bullet in `real-line-32` (its wrapped text contains two "Inclusion criteria" headings).
- Either cases: `real-line-11` (mentions translation → veto), `real-line-14` (names research
  staff → subject), `real-line-33` ("English language Limitations" in exclusion: no listed
  negation → unclear). All three are reported, not asserted.

## Independent review fixes (first review of 29df554)

The reviewer's file `lib/english-requirement.review.test.ts` (added unchanged) failed 4/4 on
29df554. Each case is fixed by a general rule, not by matching the sentence:

| Case | Was | General rule that fixes it |
|---|---|---|
| Inclusion "Illiterate in English" | `required`: "illiterate" was an ability cue with no negation | inability words are negation tokens (R2.4) |
| Exclusion "English-speaking patients with no prior treatment" | `required`: "no" anywhere on the line was read as lack of English | exclusion negation must be bound to English or its ability word (R2.5) |
| Inclusion "Able to attend all visits. Study materials are written in English." | `required`: "able" (visits) and "English" (documents) were combined across sentences | ability must be a language-use word in the same clause as English; "able"/"ability" alone no longer count (R2.8) |
| "Non-English speakers may participate with an interpreter." before the Inclusion heading | `required`: text before the first heading was ignored | vetoes are checked on every English line of the whole text (R3.4) |

`lib/english-requirement.scope.test.ts` checks the same rules with other wording, positive
controls that must still flag, a 300,000+ character guard, and the new properties R10.7–R10.8.

## Testing strategy

`lib/english-requirement.test.ts` (Vitest + fast-check, both already dev dependencies):

1. **Fixture integrity**: SHA-256 of the fixture file equals the pinned value; 57 cases.
   The file is LF-only. If a Windows checkout with `core.autocrlf=true` has rewritten it to
   CRLF, the test also accepts the hash of the CRLF→LF bytes (the committed blob), and only
   in that case; any other byte change fails.
2. **Fixture assertions**: no-flag → `status !== "required"`; flag → `status === "required"`;
   either → not asserted; a status-count coverage table is printed per group. `expectReason`
   is checked as a secondary assertion for study/synthetic no-flag cases.
3. **Behavior regressions**: polarity (both directions), veto precedence (veto after an
   earlier unclear line; veto in another section), subject lines, missing/duplicate/
   out-of-order headings, English outside any section, evidence order and casing, "New
   England"/"Englishman", 50,000+ chars, non-Latin text, format changes.
4. **Properties** (≥ 100 runs each): R10.1–R10.6 in `english-requirement.test.ts`;
   R10.7–R10.8 in `english-requirement.scope.test.ts`.
5. **Review regressions**: `english-requirement.review.test.ts` (the reviewer's file,
   unchanged) and `english-requirement.scope.test.ts` (general variants and controls). Format invariance uses transforms that keep
   line and heading order (case flip, bullet-marker swap among `*`/`-`/`•`, extra spaces/tabs
   inside lines, blank lines between lines).

## Limitations (accepted)

- Conservative by design: real requirements that mention translation, staff, or use wording
  outside the negation list (e.g. "Limitations") are reported as `mentioned`.
- Studies with multiple cohort headings fail closed as `no-sections` because the shared parser
  is authoritative; improving that would mean changing `splitSections`, which is out of scope.
- Keyword lists are English-language heuristics over registry text; they are not a parser of
  meaning. The fixture set is a pinned 2026-10-27 sample, not a recall estimate for live data.
