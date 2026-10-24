# TrialPath UI — requirements

## Provenance and scope

Written retrospectively in Codex on 2026-10-24 for review on `ui/kiro`, at Neil's request. These files document the existing implementation and its follow-up. They are **not evidence of a Kiro-authored or spec-first rebuild**. Neil's existing frontend commits (`7a0f458`, `3cd409a`, `cdd898d`) were already on main. Kiro execution and review remain open tasks.

## User stories and acceptance criteria

### R1 — Find studies
As a patient or caregiver, I want to search near a Massachusetts location.
- When a user enters a condition and valid MA ZIP or grants location access, the UI shall search within 5, 10 or 25 miles and show studies nearest first.
- When input is missing or invalid, the UI shall show a labelled error and focus the first invalid field.
- When there are no results or a request fails, the UI shall show an actionable empty or retry state.

### R2 — Understand and contact a study
As a reader, I want a plain-language description, practical travel information, and a study contact.
- The detail page shall show the study ID, summary, activities, time commitment, transit access, contact information and print control.
- When plain-language content is unavailable, the UI shall label the official English fallback.
- The UI shall retain source identifiers and contact details unchanged.
- When transit or contact data is missing, the UI shall provide directions or an official study link.

### R3 — Ask whether a study may be a possible fit
- The checklist shall keep health answers in browser memory and shall not transmit or persist them.
- The UI shall show a result only after the required questions are answered. Unknown answers shall not rule someone out.
- Outcomes shall direct the reader to the study team and never claim acceptance or a medical benefit.
- When the trial or language changes, the checklist shall reset so answers cannot attach to different questions.
- Every page shall show the medical-advice disclaimer.

### R4 — Read in six languages
- The UI shall provide English, Spanish, Portuguese, Haitian Creole, Simplified Chinese and Vietnamese labels with matching placeholders and correct HTML language tags.
- Language links shall preserve the current trial and search parameters.
- Registry facts and fallback content shall be marked with their actual language.
- Draft translations shall receive fluent-speaker review before being described as reviewed translations.

### R5 — Read reported results
- The UI shall distinguish unchecked results, source-confirmed absence, fetch/validation failure and available results.
- Available results shall belong to the exact displayed NCT ID and retain source dates, group names, measure-specific participant counts, values, units, time periods and reported uncertainty.
- Malformed or incomplete reports shall fail closed to an unavailable state rather than drop comparison groups.
- The section shall show a source link and explain that group results do not predict an individual's outcome.
- The UI shall render source text safely and retain source links in print. It shall not invent statistics, success rates, patient quotes or related-study comparisons.

### R6 — Accessibility, compatibility and delivery
- Pages shall remain usable at 375px width and on desktop, with labels, focus indicators and large controls.
- Fonts shall be served from pinned local packages without a Google Fonts build dependency.
- Shared `lib/types.ts` and `lib/geo.ts` shall remain unchanged from main.
- Delivery shall be a review branch only; no merge to main. Live APIs and verified live outcome data remain backend integration work.
