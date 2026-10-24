// Shared TEST-ONLY fixture: the reviewed LIVE NCT07043426 (THRIVE-DM, BMC) eligibility
// criteria, verbatim from ClinicalTrials.gov v2 (fetched read-only during the exact-line
// fix). This file has NO ".test." / ".spec." in its name so vitest never runs it as a suite.
//
// Every hero DETAIL across the five simplify test files imports HERO_CRITERIA from here so
// they all hash identically to REVIEWED_CRITERIA_HASH["NCT07043426"] and the study-pinned,
// exact-line free-text mappings fire. Changing the criteria here (as a few regression tests
// deliberately do, via overrides) changes the hash — which is exactly the behavior under
// test.
import type { TrialDetail } from "../types";

/** The three reviewed registry lines the supported mappings are pinned to (verbatim). */
export const T2_LINE =
  "Diagnosis: Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM), confirmed by a current diagnosis in the medical record or at least two billing codes in the last two years, or an HbA1c level ≥6.5% in the last two years.";
export const T1_LINE = "Patients with Type 1 Diabetes Mellitus (T1DM).";
export const HOSPICE_LINE = "Patients receiving hospice care.";

/** The full reviewed criteriaText, exactly as the live v2 record returns it. */
export const HERO_CRITERIA = [
  "Inclusion Criteria:",
  "",
  "* " + T2_LINE,
  "* Uncontrolled T2DM: Must have an HbA1c ≥9% at the time of screening.",
  "* Health-Related Social Needs: Must have been screened for health related social needs (HRSNs) during a General Internal Medicine (GIM) visit in the last 3 months and screened positive for at least one HRSN.",
  "",
  "Exclusion Criteria:",
  "",
  "* Patients enrolled in Complex Care Management (CCM).",
  "* " + HOSPICE_LINE,
  "* Patients who are deceased",
  "* " + T1_LINE,
].join("\n");

/** Build a hero TrialDetail; `over` overrides eligibility fields (e.g. criteriaText, age). */
export function heroDetail(over: Partial<TrialDetail["eligibility"]> = {}): TrialDetail {
  return {
    nctId: "NCT07043426",
    title: "THRIVE-DM at Boston Medical Center",
    conditions: ["Type 2 Diabetes"],
    phase: "Phase 2",
    nearestSite: { name: "Boston Medical Center", city: "Boston", lat: 42.335, lon: -71.0728, locationPrecision: "facility" },
    distanceMi: 0,
    briefSummary: "A diabetes study. Call 617-555-0100 or email team@bmc.org.",
    eligibility: {
      minAgeYears: 18,
      maxAgeYears: null,
      sex: "ALL",
      healthyVolunteers: false,
      criteriaText: HERO_CRITERIA,
      ...over,
    },
    sites: [{ name: "Boston Medical Center", city: "Boston", lat: 42.335, lon: -71.0728, locationPrecision: "facility" }],
    contacts: [{ name: "Study Team", phone: "617-555-0100", email: "team@bmc.org" }],
    stops: [],
  };
}

/**
 * The hero criteria with the hospice EXCLUSION line replaced by a NEGATED line. Used by the
 * regression tests to prove the exact-line rule rejects an altered line (and that the hash
 * changes too). The three reviewed lines are otherwise preserved except the one noted.
 */
export function heroCriteriaWithHospice(replacement: string): string {
  return HERO_CRITERIA.replace("* " + HOSPICE_LINE, "* " + replacement);
}
