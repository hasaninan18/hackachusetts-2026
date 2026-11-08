# Requirements — english-requirement-detector

## Introduction

A pure, server-only detector that reads a study's registry eligibility criteria text and
reports whether the criteria **require the patient to use English**. It is the first piece
of the English-only notice feature. This spec covers the detector module and its tests
only. It does **not** add an API field, a UI notice, i18n strings, or any change to search,
detail, the quick-check, or ranking. API/UI integration needs a separate design (search no
longer fetches eligibility text; see "Out of scope").

The governing rule is asymmetric: a missed requirement is acceptable, a wrong "required"
is not. A false "English required" notice would turn away exactly the non-English speakers
TrialPath exists to serve. So the detector returns `required` only when the text is
unambiguous, and fails closed (`mentioned`) on anything else.

Source of truth: the behavior contract (`DETECTOR-CONTRACT.md` in the hand-off kit) and the
pinned fixture file `lib/test-fixtures/english-requirement.json` (SHA-256
`67f55f6ec93b57f8e4d21f7fdba8e682c35b39dd56a20dfb3c166d29e57dfc21`, a ClinicalTrials.gov
sample fetched 2026-10-27; it is not a claim about current recruitment or counts).

`lib/ingest/quality.ts` has an unrelated "non-English speakers" report heuristic for ingest
quality stats. It is not this detector and is not changed.

## Glossary

- **English line**: a criterion line (from `sectionLines()`) whose normalized form contains
  the whole word `english`, case-insensitive. "New England" and "Englishman" do not match.
- **Requirement line**: an English line that states the patient must use English (R2.4, R2.5).
- **Veto line**: an English line that shows another language is accepted (R3).
- **Subject line**: an English line about someone other than the patient (R4).
- **Unclear line**: an English line whose polarity contradicts its section, or that does not
  state a language ability (R2.6, R2.8).

## Return type

```ts
export type NotRequiredReason = "no-sections" | "other-language-allowed" | "not-about-patient" | "unclear";
export type EnglishRequirement =
  | { status: "required"; evidence: string[] }
  | { status: "mentioned"; reason: NotRequiredReason }
  | { status: "none"; reason: "no-mention" };
```

## Requirement 1 — Deterministic, pure detection

**User story:** As a reviewer, I want the decision to be a pure function, so that it is
reproducible and testable without network or model access.

1. THE SYSTEM SHALL expose `detectEnglishRequirement(criteriaText: string): EnglishRequirement`
   from `lib/english-requirement.ts`, using no network, clock, randomness, storage or LLM.
2. THE SYSTEM SHALL return exactly one of the three shapes above.
3. WHEN `criteriaText` has no whole-word `english` (case-insensitive) THE SYSTEM SHALL return
   `{ status: "none", reason: "no-mention" }`.
4. THE SYSTEM SHALL never throw for any string, including empty, whitespace-only,
   ≥ 50,000-character, and non-Latin input.

## Requirement 2 — Sections and polarity

**User story:** As a patient, I want a line that excludes non-English speakers and a line that
includes English speakers both read as a requirement, and never the reverse.

1. THE SYSTEM SHALL locate inclusion/exclusion sections only with the existing
   `splitSections()` from `lib/simplify-mappings.ts`, and SHALL NOT add a second heading parser.
2. WHEN `splitSections()` yields no usable section (missing, duplicate or out-of-order
   headings) THE SYSTEM SHALL return `mentioned / no-sections`, never `required`.
3. THE SYSTEM SHALL split each raw section with the existing `sectionLines()` and consider
   only English lines.
4. WHEN an inclusion English line states an English ability (R2.8) and contains no negation
   anywhere on the line THE SYSTEM SHALL count it as a requirement line. Inability words
   ("illiterate", "illiteracy", "non-fluent") are negations, so "Illiterate in English" under
   Inclusion is unclear. *(Independent review, case 1.)*
5. WHEN an exclusion English line states a lack of English ability THE SYSTEM SHALL count it as
   a requirement line. The negation must be BOUND to the English word or to its ability word in
   the same clause: either at most 2 tokens before it with no clause-joining word ("with",
   "who", "and", "or", …) or phrase punctuation in between ("Unable to speak English", "Not
   proficient in English", "Non-English speaking"), or, AFTER it, only a deficiency word
   (limited, poor, insufficient, inadequate, lacking) directly or after one copula ("English
   proficiency is limited"); "Language other than English" with no other language named also
   counts. A negation elsewhere on the line ("English-speaking patients with no prior
   treatment") is not bound, and neither is a bare "not" / "no" / "never" after English
   ("English speakers not on dialysis", "English literacy not assessed"); the line is unclear.
   *(Independent review, case 2; second review, issue 1.)*
6. WHEN an inclusion English line contains a negation, OR an exclusion English line has no
   negation, THE SYSTEM SHALL treat it as unclear.
7. WHEN any English line is unclear (and no veto applies) THE SYSTEM SHALL return
   `mentioned / unclear` for the whole study.
8. WHEN an English line states no patient language ability THE SYSTEM SHALL treat it as
   unclear rather than as a requirement. An ability is a language-use word (speak, read,
   write, understand, comprehend, fluent, proficient, literate, converse, communicate, or
   "language other than English") LINKED to "English": in the same clause (clauses split at
   . ; ! ?), at most 10 tokens from it, and with no link barrier in between: phrase
   punctuation (, ( ) [ ] :), a verb that gives English its own predicate (is/are/was/were/
   be/been/being, has/have/had, provided/available/written/given/offered/conducted/
   administered/printed/delivered/presented/used) or a relative word (who/whom/whose/which/
   that/where/while/because/if/when). "Able to understand study procedures, questionnaires
   are in English" is therefore unclear. *(Second review, issue 2.)* "Able"/"ability" alone, "written", "consent" and a bare
   "language" are not ability words: they describe capabilities or documents ("Able to attend
   all visits. Study materials are written in English."). *(Added in design for fixture
   `real-line-30`, "child is exposed to English at least 50% of the time"; clause scope and
   the removal of "able"/"ability" added after the independent review, case 3.)*
9. WHEN the text mentions English but no English line falls inside a usable section (e.g.
   only in a preamble before the first heading) THE SYSTEM SHALL return `mentioned / unclear`.

## Requirement 3 — Vetoes (other language accepted)

1. WHEN any English line names another language (Spanish, Portuguese, Haitian Creole,
   Creole, French, Mandarin, Cantonese, Chinese, Vietnamese, Russian, Arabic, Korean, Cape
   Verdean, Somali and similar), "other languages", "any language", "preferred language", or
   uses a plural "languages", THE SYSTEM SHALL return `mentioned / other-language-allowed`.
2. WHEN any English line mentions `interpret*` or `translat*` THE SYSTEM SHALL return
   `mentioned / other-language-allowed`.
3. WHEN any English line says non-English speakers are welcome, allowed, eligible, "will not
   be excluded", "still eligible", "may join", "may participate", or that English "is not
   required", THE SYSTEM SHALL return `mentioned / other-language-allowed`. Hedged or
   conditional wording (preferred, preferably, ideally, encouraged, "if possible", unless,
   except, accommodated) is treated the same way: it does not state a firm requirement.
4. Vetoes SHALL apply across the whole study and take precedence over requirement, subject
   and unclear lines. THE SYSTEM SHALL check vetoes on every English line of the WHOLE
   criteria text, including text before the first heading (a plain line split, not a second
   heading parser), once usable sections exist. Requirement evidence still comes only from the
   shared parser's sections. *(Independent review, case 4: "Non-English speakers may
   participate with an interpreter." before the Inclusion heading.)*

## Requirement 4 — Whose English

1. WHEN an English line names a non-patient subject (parent, caregiver, guardian, clinician,
   staff, provider, partner, proxy, doula, family, father, mother, teacher, coach and similar)
   THE SYSTEM SHALL ignore it as a requirement; it neither flags nor vetoes unless R3 matches.
2. WHEN the only English lines are subject lines THE SYSTEM SHALL return
   `mentioned / not-about-patient`.

## Requirement 5 — Decision

1. THE SYSTEM SHALL return `required` only when at least one requirement line exists AND no
   line is a veto AND no line is unclear.
2. WHEN `required`, `evidence` SHALL list the `sectionLines().original` text of every
   requirement line, in document order, casing kept. Evidence is for tests and the staff
   review tool and SHALL NOT be exposed to any route or patient UI in this change.
3. Whitespace, case and bullet-marker changes SHALL NOT change the status.

## Requirement 9 — Tests from real text

1. `lib/test-fixtures/english-requirement.json` SHALL be a byte-for-byte copy of the kit
   fixture; its SHA-256 SHALL equal the pinned value.
2. Every `expect: "no-flag"` fixture SHALL assert `status !== "required"` (hard safety
   assertion, zero failures allowed).
3. Every `expect: "flag"` fixture SHALL assert `status === "required"`.
4. `expect: "either"` fixtures SHALL NOT be asserted; the test prints a status-count table.
5. Line fixtures SHALL be wrapped as `"<Inclusion|Exclusion> Criteria:\n\n* " + line`.

## Requirement 10 — Property tests (fast-check, ≥ 100 runs each)

1. Never throws and returns a valid shape for any string.
2. Deterministic.
3. No `english` word → never `required`.
4. Swapping "Inclusion"/"Exclusion" in a `required` fixture's headings → never `required`.
5. Appending any veto line to any criteria → never `required`.
6. Case, bullet-marker and whitespace changes on any fixture keep its status.
7. Appending a clause with an unrelated negation (" with no prior treatment", "; no prior
   chemotherapy", …) to a positive English line under Exclusion → never `required`.
   *(Independent review.)*
8. A generic-ability clause joined to an English-documents clause → never `required`; a veto
   line before the first heading → never `required`. *(Independent review.)*
9. A non-deficiency negation after an English subject ("English speakers not / no longer /
   never …") under Exclusion → never `required`. *(Second review.)*
10. A language-ability word separated from an English-documents phrase by a link barrier
    (", ", ": ", "(…) and has", "which", "that") → never `required`. *(Second review.)*

## Out of scope

- Any API, route, UI, i18n, shared-type, search or quick-check change; national mode.
- Wiring the detector into search results: current search fetches `CTG_SEARCH_FIELDS`
  without eligibility text and can scan up to 4,000 records, so integration needs its own
  design that covers live search, detail and DB results without a per-result detail fetch.
