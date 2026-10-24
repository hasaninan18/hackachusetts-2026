# Find a doctor — design

> ⚠️ **STATUS: PLANNED — NOT IMPLEMENTED (2026-10-24).** Draft design only. Nothing here exists in code yet.

## Overview
`/[lang]/results?…&tab=doctors` renders a Doctors & clinics view from `GET /api/doctors?cond=&lat=&lon=&radius=`. The trial page links to the same view centered on the study site (`&near=study`).

## Data sources
- **NPI Registry API v2.1** (specialists). Free, no key, verified 2026-10-24. Filter `addresses[]` to `address_purpose === "LOCATION"` and `state === "MA"`. Distance from the practice ZIP centroid (`lib/ma-zips.json`), with `locationPrecision: "zip"`.
- **HRSA health-center sites** (data.hrsa.gov). Access method not yet verified. A dated, cited Massachusetts snapshot is acceptable.

## Contract (draft; not yet in `lib/types.ts`)
See `docs/FRONTEND_PLAN.md` §17 (`Provider`, `DoctorsResponse`).

## Components (planned)
- `components/ResultsTabs.tsx`: a `<nav>` with two links and `aria-current="page"`.
- `components/DoctorList.tsx` and `components/ProviderItem.tsx`: server components reusing `LineChip`, `telHref` and `formatMiles`.
- A trial-page link in `app/[lang]/trial/[nct]/page.tsx`.

## Safety
Follows `.kiro/steering/safety.md`: distance-only ordering, no endorsement wording, and no health data in requests. Add endorsement words to the forbidden-phrase tests.
