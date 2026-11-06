## 17. Doctors & clinics tab — ⚠️ PLANNED, NOT IMPLEMENTED

> **Status (2026-10-24):** plan only. None of the components, routes, types or strings below exist yet. Product scope and safety rules: PLAN.md "Planned idea: Doctors & clinics tab". Backend notes: BACKEND_NOTES.md §8.

### Screens
- **`/[lang]/results?…&tab=doctors`**: a second tab next to Studies. The tabs are two `<a>` links in a `<nav aria-label>`, with `aria-current="page"` on the active one. Switching keeps `cond`, `lat`, `lon`, `radius` and `mock`. The studies tab stays the default.
- **Doctors tab content:**
  - A line at the top: "You usually don't need a referral. The study team can answer your questions."
  - Two headed groups, **Community health centers** and **Specialists for {condition}** (or **Primary care** when no specialty is mapped).
  - Each entry: name (h3), specialty, practice address, `tel:` link via `lib/phone.ts`, "About {mi} miles away", nearest T stop with LineChip and wheelchair text.
  - Footer note: "TrialPath doesn't endorse these doctors. Call to check if they take new patients and your insurance."
- **Trial page:** a link "Find doctors near {study hospital}" pointing to `/[lang]/results?cond=…&lat=<site lat>&lon=<site lon>&radius=…&tab=doctors&near=study`. When `near=study`, the tab heading says "near {hospital}" instead of "near you".
- **Print summary:** add "Questions to ask your doctor about this study" (4–5 fixed, translated questions; no AI).

### Draft contract (to agree with Hasan; NOT yet in `lib/types.ts`)
```ts
interface Provider {
  kind: "health_center" | "specialist";
  name: string;
  specialty: string | null;     // registry taxonomy text, English
  address: string; city: string; zip: string;
  phone: string | null;         // passed through untouched
  lat: number; lon: number;     // practice ZIP centroid unless the source gives coordinates
  locationPrecision: "facility" | "zip";
  distanceMi: number;
  source: "NPI" | "HRSA"; sourceId: string;  // NPI number or HRSA site id
  nearestStop?: Stop;
}
// GET /api/doctors?cond=&lat=&lon=&radius=
interface DoctorsResponse { specialty: string | null; healthCenters: Provider[]; specialists: Provider[] }
```

### States
| State | Shown |
|---|---|
| Loading | Skeleton list + sr-only status text |
| Empty group | "No {group} found within {mi} miles", plus a link to widen to 25 mi |
| Error | "We couldn't load doctors right now", a retry link, and the study-team contact |
| Mock mode | Fixtures built from real NPI records with names and phones kept as published. No invented doctors. |

### New UI strings (all six languages, through the i18n tests)
`results.tabStudies`, `results.tabDoctors`, `doctors.noReferral`, `doctors.healthCenters`, `doctors.specialists`, `doctors.primaryCare`, `doctors.nearYou`, `doctors.nearStudy`, `doctors.away`, `doctors.disclaimer`, `doctors.empty`, `doctors.error`, `doctors.findNearStudy`, `print.doctorQuestions` (+ question keys). The forbidden-word tests also need endorsement words ("best", "top-rated", "recommended" and equivalents).

### Done checks (when built)
- Tab switch keeps the query.
- Keyboard-only path works.
- 375 px has no horizontal scroll.
- axe reports 0 violations.
- No request contains quick-check answers.
- Massachusetts practice addresses only.
- Distances sorted ascending.
