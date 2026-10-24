# TrialPath MA — Demo Data & Data Fixes

_Researched and independently re-verified against live ClinicalTrials.gov, MBTA V3 and US Census geocoder APIs on 2026-10-24._

## ⚠️ Critical data bug: Boston geoPoints
ClinicalTrials.gov returns the **same geoPoint for all Boston sites**: 42.35843, -71.05977 (277 site records, 75 facilities). Consequences:
- "Nearest T stop" would show Government Center for every hospital.
- `filter.geo=distance(...)` matches against that centroid — from Dorchester (42.3016,-71.0676) it is 3.95 mi away, so radii under ~4 mi drop every Boston trial.

**Fix (backend):** a facility-coordinate override table in `lib/facilities.ts`; when a site's geoPoint equals the Boston centroid, match the facility name (normalize: lowercase, "&"→"and", strip punctuation, substring match e.g. "brigham", "boston medical center", "beth israel"/"bidmc", "massachusetts general"/"mgh", "boston children") and use the override. Default search radius **≥ 5 mi**, or search by state and compute distance from corrected coordinates.

## Hospital coordinates

Census results are address-range interpolations, so they aren't ground truth. No coordinate in the doc is more than 0.2 mi from the Census result, which means **none needs correcting**.

| Facility | Doc (approx.) | Census geocoder (matched address) | Offset | Use |
|---|---|---|---|---|
| Boston Medical Center | 42.3350, -71.0728 | 1 BMC Pl → 42.33470, -71.07540; 725 Albany St → 42.33552, -71.07078 | 0.134 / 0.109 mi | **42.3350, -71.0728** (lies between the two Census points, on the campus) |
| Brigham and Women's | 42.3359, -71.1074 | 75 Francis St → 42.33501, -71.10607 | 0.092 mi | **42.3355, -71.1067** (midpoint) |
| BIDMC (East) | 42.3393, -71.1069 | 330 Brookline Ave → 42.33982, -71.10623 | 0.050 mi | **42.3396, -71.1066** |
| MGH | 42.3626, -71.0689 | 55 Fruit St → 42.36249, -71.06983 | 0.048 mi | **42.3625, -71.0694** |
| Boston Children's | 42.3375, -71.1056 | 300 Longwood Ave → 42.33795, -71.10570 | 0.032 mi | **42.3377, -71.1057** |

Source: https://geocoding.geo.census.gov/geocoder/locations/onelineaddress (benchmark Public_AR_Current), queried 2026-10-24.

## MBTA re-check (using the "Use" coordinates; straight-line miles)

| Site | Nearest stops (id, type, wheelchair_boarding) |
|---|---|
| BMC | 91 E Concord St (5089, bus, wc=1) 0.047; Albany St opp Boston Medical (10014, bus, wc=1) 0.063. Routes at 5089: CT3, 8, 10, 171. At 10014: CT3, 8, 10, 47. **Silver Line SL4/SL5** stops Washington St @ Worcester St (1787/15176, wc=1) are **0.22 mi** away, and Washington St @ Mass Ave (5/55, wc=1) 0.24 mi. Rail: Newmarket (Fairmount commuter rail, wc=1) 0.64 mi; Massachusetts Ave (Orange, wc=1) 0.71 mi; Andrew (Red, wc=1) 0.84 mi. Broadway is not within 0.6 mi. |
| BWH | Fenwood Road (70251, Green E, **wc=2**) 0.131; Brigham Circle (70249, Green E, wc=1) 0.139; Huntington Ave @ Fenwood Rd bus (wc=1) 0.133 |
| BIDMC | Brookline Ave @ Longwood Ave (1804, bus, wc=1) 0.037; Longwood (Green D) remains the nearest rail, per the doc |
| MGH | Charles/MGH (70073, Red, wc=1) 0.141; Science Park/West End (Green, wc=1) 0.301; Bowdoin (Blue, **wc=2**) 0.384 |
| BCH | Longwood Ave @ Binney St (11803, bus, wc=1) 0.036; Longwood Ave @ Blackfan St (wc=1) 0.066 |

**Maria's trip (Dorchester point 42.3016,-71.0676, no car): realistic.**
- Fields Corner (Red, wc=1) is 0.31 mi from her. It's served by Red, 15, 17, 18, 19, 201, 202 and 210.
- Route A: Red Line inbound to **Andrew** (wc=1; routes CT3, 10 stop there), then bus 10 or CT3 to 91 E Concord St / Albany St (wc=1).
- Route B: Red Line to **JFK/UMass**, then bus 8.
- Route C: the Fairmount Line from Four Corners/Geneva (0.52 mi, wc=1) to Newmarket (0.64 mi from BMC).
- So "bus stop only" undersells it. Better badge copy: "Bus at the door; Silver Line 0.2 mi; Red Line + 1 bus from Dorchester". This is still not trip-planned, so don't claim travel times.

## Recommended prompt rules (simplify step)

1. Output JSON only: `{summary, questions:[{text, why, source_criterion, kind: "inclusion"|"exclusion"}], staff_checks:[...]}`, with no markdown. The app renders it.
2. Write at a 6th–8th grade level. Sentences of 15 words or fewer, and questions of 20 words or fewer. Define any medical term in parentheses the first time it appears, e.g. "A1c (your average blood sugar over about 3 months)".
3. Never use: eligible, qualify, qualified, accepted, approved, guaranteed, cure, free treatment. Use "may be a fit to discuss with the study team".
4. One fact per question. Never join two conditions with "and" or "or".
5. Every question must map to a quoted `source_criterion`. Never add time words (e.g. "right now") or thresholds that aren't in the text.
6. Always include an age question built from the structured minimumAge and maximumAge fields, and a "Do you get care at [site]?" question when the criteria require being a patient at a clinic.
7. Include at least one exclusion question when a patient-answerable exclusion exists. Send to `staff_checks` (never ask) anything that's administrative, staff-judged, or not self-knowable: deceased, consent ability, opted out of research, care-management programs, lab cutoffs from the record, and investigator judgment.
8. Sensitive-topic rule: never ask about pregnancy, mental-health scores, weight/BMI, substance use, or HIV status as a direct question. Use gentle wording ("Has your child's doctor talked with you about their weight?") or move it to `staff_checks` ("The study team will ask about mood.").
9. Never turn a questionnaire score (PHQ-9, GAD-7) into a self-scored quiz.
10. When a criterion needs a number most people don't know (A1c, eGFR, pack-years), phrase the question so "I'm not sure" is natural. The app always offers Yes / No / Not sure.
11. The summary (80 words or fewer) must name the hospital and say what participants do. If the design is randomized, include "You may be put by chance in a group that gets usual care." Also include "Taking part is your choice."
12. Do not "correct" or reinterpret the registry's logic. Restate it faithfully even when it looks odd.
13. Proxy mode: if the criteria describe a child or caregiver, address the caregiver ("your child") and include a caregiver-age question.
14. Spanish: neutral Latin American Spanish, **usted** register, same JSON structure, translated from the English JSON (not re-summarized separately), so both languages ask the same questions.
15. 3 to 6 questions, ordered from most to least likely to rule out.

## Recommended demo lineup

1. **HERO: NCT07043426 THRIVE-DM, BMC.** Maria is a BMC primary-care patient. The transit story is Red Line → Andrew → bus 10/CT3, ♿ throughout, with the Silver Line 0.2 mi away. The summary has to mention usual care. Expected questions: 18+; type 2 diabetes; A1c ≥9 (not sure OK); BMC primary-care patient; asked about food/housing/bills in the last 3 months and said you needed help; hospice (exclusion).
2. **NCT05784922 Lung-screening equity, MGH** (Spanish-language showcase, adults, Red Line direct). Replaces PRISM.
3. **NCT07719049 FaceAge, BWH** (healthy volunteers, Fenwood Road wc=2 accessibility moment).
4. **NCT06610448 Wearable BP, BIDMC** (healthy volunteers accepted; summary must be honest about 24-hour-plus device wear).
5. **NCT06432790 CHAMPION, MGH:** only if rules 7, 8 and 13 are in place. Otherwise bench it.

Bench: NCT06555939 (sensitive), NCT05799222 (excludes most diabetes meds; closes 2026-11-08), NCT06948838 (existing patients only, no site contacts).
