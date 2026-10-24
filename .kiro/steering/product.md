# Product (TrialPath MA)

## What it is
TrialPath MA turns any recruiting Massachusetts clinical trial into a **plain-language, multilingual "might this fit me?" checklist**, and shows **how to reach the site by the T** — including whether the nearest stop is wheelchair accessible. It never says "you're eligible"; it gets people to a confident conversation with the study team.

Hackathon: **Hackachusetts 2026**, Healthcare & Biotech track, challenge **H5 — "Making clinical research more accessible"**.

## Who it serves
- **Patients and caregivers**, especially non-English speakers and people without cars.
- **Referring clinicians** who want a quick shortlist for a patient.
- **Research teams** struggling to recruit diverse participants.

## MVP — what the demo must show
1. **Search**: condition (free text) + location (MA ZIP or "use my location") + max distance (5/10/25 mi) → recruiting MA trials, nearest first.
2. **Plain-language trial card**: what it studies, what you'd do, time commitment — ~8th-grade reading level.
3. **"Might this fit me?" quick-check**: structured checks (age range, sex, healthy volunteers) + 3–6 simple yes/no/not-sure questions generated from the eligibility text. Outcome is always "possible fit / may rule you out / not sure" — **never "eligible"**.
4. **Getting there**: nearest MBTA stops (name, lines, ♿ accessible, walking distance) + a Google Maps transit deep link (no key).
5. **Language toggle** — **demo scope: English, Spanish, Portuguese, Haitian Creole, Chinese (Simplified)**. Always label the Chinese option **Simplified Chinese** explicitly — never a generic "Chinese" toggle.
   - **Stretch language** (only if ahead and spot-checked): Vietnamese.
   - All translations are labeled **machine-translated**. Any language that ships must have its forbidden-phrase equivalents in `safety.md` first, and the forbidden-phrase hook must check its cached translations before caching.
6. **Contact the study team**: central/site contact from the API + a printable/shareable summary to bring to a doctor.

## Stretch (only if ahead at 4 PM)
- Save/compare trials.
- Clinician mode (paste age/condition → shortlist).
- Equity overlay with MassGIS environmental-justice block groups.

## Out of scope
- User accounts.
- Storing health info (nothing leaves the browser except the search query).
- Any eligibility decision or medical advice.

## Our edge (vs. ClinicalTrials.gov itself / TrialGPT)
MA-specific · multilingual · transit + accessibility · plain-language questions · privacy (no health data stored).
