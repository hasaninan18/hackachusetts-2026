# Find a doctor — reduced optional requirements

Status: **planned, not implemented; last priority**. This adapts Neil's full proposal. Follow [the reduced plan](../../../docs/DOCTORS_REDUCED_PLAN.md); the [full original](../../../docs/post-competition/find-a-doctor-full/README.md) is deferred, not today's executable scope.

1. **Gate:** implementation must not delay an owner's core work; release only if fully integrated and verified by 4:15 PM ET October 24, with core submission safe. Otherwise remain unmerged/disabled. No new features after 5 PM.
2. **Data:** use only documented CMS NPI Registry v2.1 individual-provider/practice-address/taxonomy query behavior; no HRSA. Keep MA practice locations, skip unusable ZIP centroids, and bound pagination and calls. Show published data faithfully and label approximate distances and limited coverage.
3. **Search:** fixed reviewed specialty mapping with explicit primary-care fallback, inclusive local radius filtering and distance-only sort. Do not claim exhaustive nearest-provider coverage or medical suitability.
4. **UI:** an optional provider view/list and trial-page link, preserving search/corrected study origin; studies default. Real/mock/loading/empty/error states; study contact remains reachable. No partial mock-only live feature.
5. **Languages:** new EN/ES copy; existing six-language trial experience must remain intact. Other-language directory access has an explicit safe EN/ES choice/fallback, no missing keys or misleading language labels.
6. **Privacy/safety:** only condition/location/radius leave the browser. No health answers/profiles. No endorsement, booking, insurance/new-patient promise, trial affiliation or guaranteed referral. Ask the study team whether a referral is needed.
7. **Scope exclusions:** no HRSA group, provider MBTA/accessibility data, exact geocoding/walking distance, extra print features or new provider translations beyond EN/ES.
8. **Proof:** source spot check; focused tests; integrated tests/typecheck/lint/build; EN/ES real browser flow, 375px/desktop/keyboard, privacy check and core regression review before any merge. Tests use mocked network.
