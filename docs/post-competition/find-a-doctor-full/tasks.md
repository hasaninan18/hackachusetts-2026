# Find a doctor — tasks

> ⚠️ **STATUS: PLANNED — NOT IMPLEMENTED (2026-10-24).** None of these tasks have been started. Do not run them until the team agrees, after the core submission is safe.

- [ ] 1. Hasan: verify the HRSA health-center data access method and record it in `docs/BACKEND_NOTES.md` §8.
- [ ] 2. Hasan: `lib/npi.ts` — query, MA practice-location filter, ZIP-centroid distance, condition → specialty table, with unit and fast-check tests (R5).
- [ ] 3. Hasan: `GET /api/doctors` route with 10-minute cache and capped nearest-stop lookups (R1, R4).
- [ ] 4. Neil: add `Provider` / `DoctorsResponse` to `lib/types.ts` once Hasan agrees the contract.
- [ ] 5. Neil: `ResultsTabs` + `DoctorList` + states, and the trial-page "Find doctors near {hospital}" link (R1, R2, R6).
- [ ] 6. Neil: new strings in all six languages; "questions to ask your doctor" in the print summary (R3, R6).
- [ ] 7. Akash: extend forbidden-phrase tests with endorsement words; privacy test that no request carries quick-check answers (R3, R4).
- [ ] 8. All: browser check at 375 px and 1440 px, keyboard path, axe 0 violations, English + Spanish (R6).
