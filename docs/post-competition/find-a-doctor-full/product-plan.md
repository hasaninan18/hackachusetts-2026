### Planned idea: "Doctors & clinics" tab (Neil) — ⚠️ PLANNED, NOT IMPLEMENTED
> **Status (2026-10-24):** agreed as a plan only. No code, API route or UI exists yet. Do not demo it or describe it as built. Start only once the core submission is safe (after the 5 PM freeze or post-hackathon, unless the whole team agrees otherwise).

After people find studies, many want a doctor's help before contacting a study team. That could be their own doctor, someone nearby, or someone at the hospital running the study. A referral is usually **not required**: most studies accept people who contact the team directly, and the team screens them. Some studies do ask for medical records or a doctor's note, and many people simply want their own doctor's opinion. The feature presents a doctor as an option, never as a requirement.

- **Where:** a second tab on the results page, filled by the same search (condition + location + distance): `[ Studies (12) ] [ Doctors & clinics (8) ]`. The tabs are two plain links (`?tab=studies` / `?tab=doctors`), so Back, sharing, keyboard and screen readers work without a script-driven tab widget.
- **Two groups in the tab:**
  1. **Community health centers near you.** They see people with or without insurance and use sliding-scale fees. This matters most for the target users (non-English speakers, low income, no regular doctor).
  2. **Specialists for the condition near you.** The condition maps to a specialty through a small fixed table (e.g. diabetes → endocrinology), with primary care as the fallback. No AI guessing.
- **Each entry:** name, practice address, phone (tap to call), approximate distance, nearest T stop and wheelchair access (reusing Getting there).
- **On the trial page:** one link, "Find doctors near [study hospital]". It opens the Doctors tab centered on the study site instead of the user's ZIP. Optionally also link to that hospital's own "find a doctor" or referral page, from a small table of major Boston hospitals.
- **Copy additions (plain language):** "You usually don't need a referral. The study team can answer your questions." Plus a short, translated "Questions to ask your doctor about this study" list added to the print summary.
- **Safety and privacy (safety.md):**
  - Only the condition and location leave the browser, the same as search. Quick-check answers never do.
  - List by distance only, never "best", "top" or "recommended".
  - Show "TrialPath doesn't endorse these doctors" and "Call to check if they take new patients and your insurance". The registry doesn't say either.
  - No ratings or reviews.

**Data sources (planned):**
- **NPI Registry API** (CMS, free, no key). Verified working on 2026-10-24. Quirk: its ZIP filter also matches mailing addresses (a search near 02124 returned a Miami doctor), so results must keep only Massachusetts *practice-location* addresses. See BACKEND_NOTES.md §8.
- **HRSA health-center sites data** (data.hrsa.gov). Access method **not yet verified**.

**Ownership when started:**
- Hasan: `GET /api/doctors`
- Neil: the tab, list, states and trial-page link
- Akash: safety wording review and tests (no endorsement or ranking language; nothing beyond condition and location sent)

**Acceptance checks (when built):**
- Both tabs work from one search and keep the query when switching.
- Results are Massachusetts practice addresses only, sorted by distance.
- Empty and error states are shown, with the study-team contact always still visible.
- All UI text is translated, with no endorsement words.
- Phone links dial correctly.
- Keyboard and 375 px layouts work.
- No health answers appear in any request.

Details: FRONTEND_PLAN.md §17, BACKEND_NOTES.md §8, `.kiro/specs/find-a-doctor/`.

