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
  ├─ sectionLines(inclusionRaw) tagged "inclusion",
  │  sectionLines(exclusionRaw) tagged "exclusion"   (document order)
  │    keep lines whose .normalized has whole-word "english"
  │    none kept (English only outside sections) ────────► mentioned / unclear
  │
  ├─ classify every English line (table below)
  │
  └─ decide, in strict precedence:
       1. any veto            → mentioned / other-language-allowed
       2. any unclear         → mentioned / unclear
       3. any requirement     → required, evidence = originals in order
       4. only subject lines  → mentioned / not-about-patient
```

Vetoes are evaluated over the whole study before anything else, so one veto line anywhere
cancels every requirement line, and a veto that appears after an earlier unclear line
still wins (reason `other-language-allowed`).

## Line classification

Each English line's `normalized` form (bullet stripped, whitespace collapsed, lower-cased by
`normalizeLine`) is tested in this order; the first match wins:

| Step | Test | Class |
|---|---|---|
| 1 | names another language, plural "languages", "any/preferred/sign language", bilingual | veto |
| 2 | `interpret*` or `translat*` | veto |
| 3 | welcome / allowed / permitted / eligible / "will not be excluded" / "may join" / "may participate" / "may be included" / "not required" | veto |
| 4 | names a non-patient subject (parent, caregiver, guardian, clinician, staff, provider, partner, proxy, doula, family, father, mother, teacher, coach, spouse, physician, nurse, …) | subject |
| 5 | no language-ability cue (speak, read, write, understand, comprehend, fluent, proficien*, literate, convers*, communicat*, consent, able/ability, language) | unclear |
| 6 | polarity: inclusion ∧ ¬negation, or exclusion ∧ negation | requirement |
| 7 | otherwise (inclusion ∧ negation, or exclusion ∧ ¬negation) | unclear |

**Negation** (whole words): `non-english`, `not`, `no`, `unable`, `inability`, `cannot`,
`can not`, any `…n't`, `lack*`, `poor`, `limited`, `insufficient`, `inadequate`, `without`,
`other than english`. "other than English" only acts as negation after step 1 has already
ruled out a named second language, so "Primary language other than English or Spanish" is a
veto and "Language other than English" is an exclusion requirement.

All patterns are anchored on `\b` word boundaries and use no nested quantifiers, so matching
is linear in the line length (the ≥ 50,000-character test guards this).

### Why step 5 exists (design addition to the contract)

A literal reading of contract R2.4 makes every inclusion English line without a negation a
requirement. Fixture `real-line-30` (`no-flag`) is exactly that: "Lives in an environment
where child is exposed to English at least 50% of the time". It describes exposure, not the
patient's ability, and must not flag. Step 5 sends any English line that states no language
ability to `unclear`. All 16 `flag` fixtures carry an ability cue, so the addition costs no
asserted recall. The first implementation omitted step 5 and failed this fixture; see
tasks.md task 4.

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
4. **Properties** (≥ 100 runs each): R10.1–R10.6. Format invariance uses transforms that keep
   line and heading order (case flip, bullet-marker swap among `*`/`-`/`•`, extra spaces/tabs
   inside lines, blank lines between lines).

## Limitations (accepted)

- Conservative by design: real requirements that mention translation, staff, or use wording
  outside the negation list (e.g. "Limitations") are reported as `mentioned`.
- Studies with multiple cohort headings fail closed as `no-sections` because the shared parser
  is authoritative; improving that would mean changing `splitSections`, which is out of scope.
- Keyword lists are English-language heuristics over registry text; they are not a parser of
  meaning. The fixture set is a pinned 2026-10-27 sample, not a recall estimate for live data.
