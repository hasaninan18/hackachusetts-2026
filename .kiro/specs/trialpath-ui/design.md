# TrialPath UI — design

## Provenance

Retrospective design documentation written in Codex on 2026-10-24. It records the existing frontend and the Codex follow-up; no Kiro spec execution is claimed.

## Existing application

Next.js App Router renders `/[lang]`, `/[lang]/results`, and `/[lang]/trial/[nct]`. Server pages load facts through `lib/data.ts`. `TRIALPATH_MOCK=1` or `?mock=1` selects local fixtures while backend routes are unavailable. SearchForm resolves MA ZIP codes locally before navigating with condition, rounded location and radius.

TrialPlain loads simplified text asynchronously and gives the checklist questions to QuickCheck. QuickCheck stores answers only in component state; language/trial changes reset it. GettingThere, ContactCard and PrintButton complete the existing detail flow. This architecture and the earlier accessibility fixes are Neil's already-committed work.

## Translation completion

`lib/i18n/en.ts` defines the dictionary contract. Separate `es.ts`, `pt.ts`, `ht.ts`, `zh.ts` and `vi.ts` dictionaries satisfy that contract. Tests enforce complete keys, exact placeholders and forbidden-claim rules. Official source content remains English and is tagged accordingly; UI translation does not imply that every mock trial has translated content. Fluent-speaker review remains outstanding.

## Reported results extension

`lib/outcomes.ts` owns `StudyOutcomes`, `OutcomeMeasure`, `TrialDetailWithOutcomes`, and `parseOutcomes`. `TrialDetailWithOutcomes` intersects the existing shared TrialDetail with an optional outcomes field. No shared backend file is modified.

The data adapter parses the optional field. StudyResults also validates at its rendering boundary so mocks and other callers cannot bypass validation. Missing data is `not_checked`; `not_posted` requires a matching NCT ID and a valid source-check date; available reports require a matching ID, valid posting date and complete measures/groups. Invalid data becomes `unavailable`.

The server-rendered section uses stacked groups for narrow screens. It preserves source statistics instead of calculating percentages or personal scores. Source text is escaped, marked as English, and linked to a fixed ClinicalTrials.gov URL for the same NCT ID. The printed version includes that URL. Checklist state never affects this section.

There are no invented production outcome fixtures. Synthetic results exist only in tests. Hasan must source and verify live results before enabling that integration; the optional extension is a proposed contract for his review.

## Fonts

Pinned Fontsource Noto Sans and Noto Sans SC packages provide local CSS and font assets. Unicode ranges let browsers load the needed glyph subsets. The layout imports these assets, and the global font stack retains system fallbacks. npm lockfile integrity remains enabled.

## Validation

Unit/property tests cover existing frontend logic, translations and results validation. Server rendering tests cover results states, source fidelity and text escaping. The current production build and type checker must pass. Browser checks cover six home-page languages, mobile/desktop widths, Spanish search/detail/checklist, answer privacy, language reset, and print-source visibility. These checks do not establish live API readiness, fluent-speaker approval, or a completed manual accessibility audit.
