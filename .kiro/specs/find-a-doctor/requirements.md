# Find a doctor — requirements

> ⚠️ **STATUS: PLANNED — NOT IMPLEMENTED (2026-10-24).** This spec records an agreed plan. No code exists for it. Do not run these tasks until the core submission is safe and the team agrees to start. Scope and safety rationale: `docs/PLAN.md` "Planned idea: Doctors & clinics tab".

## User stories and acceptance criteria

### R1 — See doctors and clinics from the same search
As a patient or caregiver who found studies, I want nearby doctors and clinics without searching again.
- WHEN a user views results, THE UI SHALL offer two tabs, Studies and Doctors & clinics, as links that keep the condition, location, distance and mock flag.
- WHEN the Doctors & clinics tab is open, THE UI SHALL list community health centers and specialists for the searched condition (or primary care when no specialty is mapped), each sorted by distance.
- THE UI SHALL show for each entry: name, specialty, practice address, a dialable phone link, approximate distance, and the nearest T stop with wheelchair access in text.

### R2 — Doctors near the study hospital
- WHEN a user is on a trial page, THE UI SHALL offer "Find doctors near {study hospital}", which opens the Doctors & clinics tab centered on the study site.

### R3 — Honest framing
- THE UI SHALL say a referral is usually not needed and that the study team can answer questions.
- THE UI SHALL state that TrialPath doesn't endorse these doctors and that people should call to check new patients and insurance.
- THE UI SHALL NOT rank, rate or label any doctor as best, top or recommended in any language.

### R4 — Privacy
- THE system SHALL send only condition, latitude, longitude and radius to `/api/doctors`. Quick-check answers SHALL never be sent or stored.

### R5 — Data accuracy
- THE API SHALL return only Massachusetts practice-location addresses. Mailing-address matches SHALL be excluded.
- THE API SHALL map conditions to specialties from a fixed table, never AI.
- WHEN coordinates come from a ZIP centroid, THE UI SHALL present the distance as approximate.

### R6 — States and accessibility
- THE UI SHALL provide loading, empty-group, error and mock states. The study-team contact SHALL stay reachable on error.
- THE tab SHALL work by keyboard and at 375 px with no horizontal scroll, and SHALL pass axe with 0 violations.
- ALL new strings SHALL exist in all six languages and pass the i18n placeholder and forbidden-word tests.
