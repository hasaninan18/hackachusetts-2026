## 8. ⚠️ PLANNED, NOT IMPLEMENTED: `GET /api/doctors` for the Doctors & clinics tab
> **Status (2026-10-24):** plan only. Nothing is built, and it's not part of the current submission scope. Frontend contract draft: FRONTEND_PLAN.md §17.

**NPI Registry (specialists)**
`https://npiregistry.cms.hhs.gov/api/?version=2.1&taxonomy_description=Endocrinology&postal_code=02124&limit=200`
- Free and needs no key. Verified on 2026-10-24.
- **Quirk:** `postal_code` and `city` also match *mailing* addresses. A 02124 search returned a Miami practice. Keep only `addresses[]` entries with `address_purpose === "LOCATION"` and `state === "MA"`.
- **Coverage:** exact-ZIP searches return very few results (2 for 02124 endocrinology). Search by `state=MA` + `city`, or by several nearby ZIPs, then compute distance yourself.
- **No coordinates:** use the practice ZIP's centroid from `lib/ma-zips.json`, mark `locationPrecision: "zip"`, and say "about" in the UI.
- Use `taxonomies[]` with `primary: true` for the specialty text. Map the condition to `taxonomy_description` with a small fixed table (diabetes → Endocrinology; asthma → Pulmonary Disease / Allergy & Immunology; breast cancer → Hematology & Oncology; …), falling back to Family Medicine / Internal Medicine. Never let AI pick the specialty.
- It returns nothing about new patients, insurance or languages spoken. Don't imply any of them.

**HRSA health centers**
Use HRSA's health-center service-delivery sites dataset on data.hrsa.gov. **Access method (API vs. bundled CSV snapshot) not yet verified.** A small bundled Massachusetts snapshot is fine for the demo if it's dated and cites its source.

**Rules**
- Inputs are only `cond`, `lat`, `lon`, `radius`. Never accept or log quick-check answers.
- Sort by distance only.
- Cache upstream for 10 minutes like trial search.
- Reuse `nearestStops()` from `lib/mbta.ts` per provider, capped (e.g. the first 10) to stay inside MBTA rate limits.
