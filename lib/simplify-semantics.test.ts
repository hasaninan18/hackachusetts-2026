// Regression + unit tests for the SEMANTIC AUTHORITY (lib/simplify-semantics.ts).
//
// These are the production semantic-safety regressions. The NEGATIVE fixtures are the EXACT
// questions a live model returned for NCT07043426 (saved at
// /private/tmp/trialpath-simplify-en-live.json and ...-es-live.json) that passed shape,
// safety, and source_criterion-substring checks yet are clinically wrong. Each must be
// REJECTED (fail closed) for the right reason. The POSITIVE fixtures are the
// deterministically-correct version of each question and must PASS. No Bedrock here — these
// are pure functions.
import { describe, expect, it } from "vitest";
import {
  checkQuestionSemantics,
  detectConditionMismatch,
  evidencePolarity,
  parseAgeSubject,
  splitCriteriaSections,
  staffOnlyClassOf,
} from "./simplify-semantics";
import type { SimplifyModel, SimplifyQuestion } from "./bedrock-types";
import type { TrialDetail } from "./types";

// ---------------------------------------------------------------------------
// Real NCT07043426 eligibility (verbatim from the ClinicalTrials.gov v2 API).
// minimumAge "18 Years" is STRUCTURED only — there is no age phrase in the free text, which
// is exactly why a model-invented age question cannot ground itself in a real quote.
// ---------------------------------------------------------------------------
const NCT07043426_CRITERIA = [
  "Inclusion Criteria:",
  "",
  "* Diagnosis: Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM), confirmed by a current diagnosis in the medical record or at least two billing codes in the last two years, or an HbA1c level ≥6.5% in the last two years.",
  "* Uncontrolled T2DM: Must have an HbA1c ≥9% at the time of screening.",
  "* Health-Related Social Needs: Must have been screened for health related social needs (HRSNs) during a General Internal Medicine (GIM) visit in the last 3 months and screened positive for at least one HRSN.",
  "",
  "Exclusion Criteria:",
  "",
  "* Patients enrolled in Complex Care Management (CCM).",
  "* Patients receiving hospice care.",
  "* Patients who are deceased",
  "* Patients with Type 1 Diabetes Mellitus (T1DM).",
].join("\n");

const DETAIL: TrialDetail = {
  nctId: "NCT07043426",
  title: "THRIVE-DM",
  conditions: ["Type 2 Diabetes"],
  phase: "NA",
  status: "RECRUITING",
  briefSummary: "A diabetes study at Boston Medical Center.",
  eligibility: {
    minAgeYears: 18,
    maxAgeYears: null,
    sex: "ALL",
    healthyVolunteers: false,
    criteriaText: NCT07043426_CRITERIA,
  },
  sites: [],
  contacts: [],
} as unknown as TrialDetail;

function model(questions: SimplifyQuestion[], staff_checks: string[] = []): SimplifyModel {
  return { summary: "s", whatYouDo: "w", timeCommitment: "t", questions, staff_checks };
}

// The exact diagnosis-paragraph quote the live model used for its (mis-grounded) questions.
const T2DM_DIAGNOSIS_QUOTE =
  "Diagnosis: Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM), confirmed by a current diagnosis in the medical record or at least two billing codes in the last two years, or an HbA1c level ≥6.5% in the last two years.";

// ---------------------------------------------------------------------------
// NEGATIVE regressions — the three observed live defects must FAIL CLOSED.
// ---------------------------------------------------------------------------
describe("live NCT07043426 defects are rejected (fail closed)", () => {
  it("DEFECT 1: type-2 question grounded in a TYPE-1 exclusion is rejected (subject + polarity/kind)", () => {
    // Verbatim from trialpath-simplify-en-live.json: the quote EXISTS in the criteria, so
    // substring matching passed, but it is about T1DM while the question asks about T2D, and
    // ruleOutIf="yes"/kind="exclusion" would wrongly rule OUT a patient who HAS type 2.
    const q: SimplifyQuestion = {
      id: "diabetes_type",
      text: "Do you have type 2 diabetes?",
      ruleOutIf: "yes",
      source_criterion: "Patients with Type 1 Diabetes Mellitus (T1DM).",
      kind: "exclusion",
    };
    const err = checkQuestionSemantics(model([q]), DETAIL);
    expect(err).not.toBeNull();
    expect(err).toContain("diabetes_type");
    // The reason is a condition-subject mismatch (type 2 question vs type 1 evidence).
    expect(err).toMatch(/different condition|does not match/i);
  });

  it("DEFECT 2: age question citing the DIAGNOSIS paragraph (not structured bounds) is rejected", () => {
    // Verbatim from the live output: the age question cited the T2DM diagnosis inclusion
    // text, NOT minimumAge. It must be grounded in the structured bound or rejected.
    const q: SimplifyQuestion = {
      id: "age",
      text: "Are you at least 18 years old?",
      ruleOutIf: "no",
      source_criterion: T2DM_DIAGNOSIS_QUOTE,
      kind: "inclusion",
    };
    const err = checkQuestionSemantics(model([q]), DETAIL);
    expect(err).not.toBeNull();
    expect(err).toContain("age");
    expect(err).toMatch(/structured age bounds|minimumAge/i);
  });

  it("DEFECT 3: CCM enrollment asked as a yes/no question is rejected (staff-only)", () => {
    const q: SimplifyQuestion = {
      id: "ccm_enrollment",
      text: "Are you enrolled in Complex Care Management?",
      ruleOutIf: "yes",
      source_criterion: "Patients enrolled in Complex Care Management (CCM).",
      kind: "exclusion",
    };
    const err = checkQuestionSemantics(model([q]), DETAIL);
    expect(err).not.toBeNull();
    expect(err).toContain("ccm_enrollment");
    expect(err).toMatch(/staff-only|staff_checks/i);
  });

  it("DEFECT 4: an HbA1c >=9% lab-threshold asked directly (word form) is rejected (staff-only)", () => {
    // A precise lab value from the record is not self-knowable; rule 7 routes it to
    // staff_checks. A live model emitted exactly this question, phrased "9% or higher".
    const q: SimplifyQuestion = {
      id: "uncontrolled_t2dm",
      text: "Do you have an HbA1c (your average blood sugar over about 3 months) level of 9% or higher now?",
      ruleOutIf: "no",
      source_criterion: "Must have an HbA1c ≥9% at the time of screening.",
      kind: "inclusion",
    };
    const err = checkQuestionSemantics(model([q]), DETAIL);
    expect(err).not.toBeNull();
    expect(err).toContain("uncontrolled_t2dm");
    expect(err).toMatch(/staff-only|staff_checks/i);
  });

  it("the FULL observed live model (all four questions) is rejected", () => {
    // The whole live `questions` array as returned. The validator stops at the first
    // violation, so we only assert it rejected; individual reasons are covered above.
    const live = model([
      {
        id: "age",
        text: "Are you at least 18 years old?",
        ruleOutIf: "no",
        source_criterion: T2DM_DIAGNOSIS_QUOTE,
        kind: "inclusion",
      },
      {
        id: "diabetes_type",
        text: "Do you have type 2 diabetes?",
        ruleOutIf: "yes",
        source_criterion: "Patients with Type 1 Diabetes Mellitus (T1DM).",
        kind: "exclusion",
      },
      {
        id: "screened_for_social_needs",
        text: "Have you been screened for health-related social needs in the last 3 months?",
        ruleOutIf: "no",
        source_criterion:
          "Must have been screened for health related social needs (HRSNs) during a General Internal Medicine (GIM) visit in the last 3 months and screened positive for at least one HRSN.",
        kind: "inclusion",
      },
      {
        id: "ccm_enrollment",
        text: "Are you enrolled in Complex Care Management?",
        ruleOutIf: "yes",
        source_criterion: "Patients enrolled in Complex Care Management (CCM).",
        kind: "exclusion",
      },
    ]);
    expect(checkQuestionSemantics(live, DETAIL)).not.toBeNull();
  });

  it("the Spanish live model is rejected too (same mistaken rule, translated)", () => {
    // trialpath-simplify-es-live.json preserved the same source_criterion verbatim, so the
    // same T1/T2 mismatch is present behind translated question text.
    const es = model([
      {
        id: "diabetes_type",
        text: "¿Tiene diabetes tipo 2?",
        ruleOutIf: "yes",
        source_criterion: "Patients with Type 1 Diabetes Mellitus (T1DM).",
        kind: "exclusion",
      },
    ]);
    // Spanish subject "diabetes tipo 2" is matched by the type-2 markers too.
    expect(checkQuestionSemantics(es, DETAIL)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE fixtures — the deterministically-correct versions must PASS.
// ---------------------------------------------------------------------------
describe("the correct deterministic mappings PASS", () => {
  it("T2DM inclusion -> 'Do you have type 2 diabetes?' ruleOutIf=no kind=inclusion", () => {
    const q: SimplifyQuestion = {
      id: "diabetes_type",
      text: "Do you have type 2 diabetes?",
      ruleOutIf: "no",
      // Grounded in the actual T2DM inclusion criterion.
      source_criterion: T2DM_DIAGNOSIS_QUOTE,
      kind: "inclusion",
    };
    expect(checkQuestionSemantics(model([q]), DETAIL)).toBeNull();
  });

  it("a lab threshold moved to staff_checks (not asked) PASSES; its evidence mention does not block the T2DM question", () => {
    const m = model(
      [
        {
          id: "diabetes_type",
          text: "Do you have type 2 diabetes?",
          ruleOutIf: "no",
          // Evidence here legitimately mentions "...or an HbA1c level >=6.5%".
          source_criterion: T2DM_DIAGNOSIS_QUOTE,
          kind: "inclusion",
        },
      ],
      ["The study team will check your HbA1c ≥9% at screening."],
    );
    expect(checkQuestionSemantics(m, DETAIL)).toBeNull();
  });

  it("age grounded in the structured minimumAge=18 bound PASSES", () => {
    const q: SimplifyQuestion = {
      id: "age",
      text: "Are you at least 18 years old?",
      ruleOutIf: "no",
      source_criterion: "minimumAge = 18 years",
      kind: "inclusion",
    };
    expect(checkQuestionSemantics(model([q]), DETAIL)).toBeNull();
  });

  it("CCM moved to staff_checks (not a question) PASSES", () => {
    const m = model(
      [
        {
          id: "diabetes_type",
          text: "Do you have type 2 diabetes?",
          ruleOutIf: "no",
          source_criterion: T2DM_DIAGNOSIS_QUOTE,
          kind: "inclusion",
        },
      ],
      ["The study team will check if you are enrolled in Complex Care Management (CCM)."],
    );
    expect(checkQuestionSemantics(m, DETAIL)).toBeNull();
  });

  it("a hospice EXCLUSION -> 'Are you in hospice care?' ruleOutIf=yes kind=exclusion PASSES", () => {
    const q: SimplifyQuestion = {
      id: "hospice",
      text: "Are you receiving hospice care?",
      ruleOutIf: "yes",
      source_criterion: "Patients receiving hospice care.",
      kind: "exclusion",
    };
    expect(checkQuestionSemantics(model([q]), DETAIL)).toBeNull();
  });

  it("the full corrected model (age structured, T2D inclusion, HRSN inclusion, CCM in staff_checks) PASSES", () => {
    const corrected = model(
      [
        {
          id: "age",
          text: "Are you at least 18 years old?",
          ruleOutIf: "no",
          source_criterion: "minimumAge = 18 years",
          kind: "inclusion",
        },
        {
          id: "diabetes_type",
          text: "Do you have type 2 diabetes?",
          ruleOutIf: "no",
          source_criterion: T2DM_DIAGNOSIS_QUOTE,
          kind: "inclusion",
        },
        {
          id: "screened_for_social_needs",
          text: "Have you been screened for health-related social needs in the last 3 months?",
          ruleOutIf: "no",
          source_criterion:
            "Must have been screened for health related social needs (HRSNs) during a General Internal Medicine (GIM) visit in the last 3 months and screened positive for at least one HRSN.",
          kind: "inclusion",
        },
      ],
      [
        "The study team will check if you are enrolled in Complex Care Management (CCM).",
        "The study team will check your HbA1c (your average blood sugar over about 3 months).",
      ],
    );
    expect(checkQuestionSemantics(corrected, DETAIL)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit coverage for the building blocks.
// ---------------------------------------------------------------------------
describe("detectConditionMismatch", () => {
  it("flags a type-2 question against a type-1 quote", () => {
    expect(
      detectConditionMismatch("Do you have type 2 diabetes?", "Patients with Type 1 Diabetes Mellitus (T1DM)."),
    ).not.toBeNull();
  });
  it("flags T1DM/T2DM abbreviation mismatch", () => {
    expect(detectConditionMismatch("Do you have T2DM?", "Patients with T1DM.")).not.toBeNull();
  });
  it("passes when subjects agree", () => {
    expect(
      detectConditionMismatch("Do you have type 2 diabetes?", "diagnosis of Type 2 Diabetes Mellitus (T2DM)"),
    ).toBeNull();
  });
  it("passes when neither names a family member", () => {
    expect(detectConditionMismatch("Are you in hospice care?", "Patients receiving hospice care.")).toBeNull();
  });
});

describe("evidencePolarity", () => {
  it("locates an inclusion quote in the inclusion section", () => {
    expect(evidencePolarity(T2DM_DIAGNOSIS_QUOTE, NCT07043426_CRITERIA)).toBe("inclusion");
  });
  it("locates an exclusion quote in the exclusion section", () => {
    expect(evidencePolarity("Patients with Type 1 Diabetes Mellitus (T1DM).", NCT07043426_CRITERIA)).toBe("exclusion");
  });
  it("returns unknown for a quote present in neither section", () => {
    expect(evidencePolarity("completely fabricated criterion", NCT07043426_CRITERIA)).toBe("unknown");
  });
});

describe("splitCriteriaSections", () => {
  it("splits real registry text with 'Inclusion Criteria:' / 'Exclusion Criteria:' headers", () => {
    const { inclusion, exclusion } = splitCriteriaSections(NCT07043426_CRITERIA);
    expect(inclusion).toContain("type 2 diabetes mellitus");
    expect(exclusion).toContain("type 1 diabetes mellitus");
    expect(inclusion).not.toContain("type 1 diabetes mellitus");
  });
  it("splits inline 'Inclusion:'/'Exclusion:' headers without the word 'Criteria'", () => {
    const { inclusion, exclusion } = splitCriteriaSections(
      "Inclusion: Age 18 or older. Type 2 diabetes. Exclusion: hospice care.",
    );
    expect(inclusion).toContain("type 2 diabetes");
    expect(exclusion).toContain("hospice care");
    expect(inclusion).not.toContain("hospice care");
  });
});

describe("parseAgeSubject", () => {
  it("parses 'at least 18 years old'", () => {
    expect(parseAgeSubject("Are you at least 18 years old?")).toEqual({ value: 18, bound: "min" });
  });
  it("parses '18 or older' without the word years", () => {
    expect(parseAgeSubject("Are you 18 or older?")).toEqual({ value: 18, bound: "min" });
  });
  it("parses '18 years or older'", () => {
    expect(parseAgeSubject("Are you 18 years or older?")).toEqual({ value: 18, bound: "min" });
  });
  it("parses an upper bound 'younger than 65'", () => {
    expect(parseAgeSubject("Are you younger than 65?")).toEqual({ value: 65, bound: "max" });
  });
  it("parses '65 years or younger' as a max bound", () => {
    expect(parseAgeSubject("Are you 65 years or younger?")).toEqual({ value: 65, bound: "max" });
  });
  it("returns null for a non-age question", () => {
    expect(parseAgeSubject("Do you have type 2 diabetes?")).toBeNull();
  });
});

describe("staffOnlyClassOf", () => {
  it("flags Complex Care Management / CCM", () => {
    expect(staffOnlyClassOf("Patients enrolled in Complex Care Management (CCM).")).toBe("care_management_enrollment");
    expect(staffOnlyClassOf("Are you enrolled in Complex Care Management?")).toBe("care_management_enrollment");
  });
  it("flags deceased", () => {
    expect(staffOnlyClassOf("Patients who are deceased")).toBe("deceased");
  });
  it("flags a lab cutoff from the record (HbA1c threshold)", () => {
    expect(staffOnlyClassOf("Must have an HbA1c ≥9% at the time of screening.")).toBe("lab_cutoff_from_record");
  });
  it("does not flag a self-knowable question", () => {
    expect(staffOnlyClassOf("Do you have type 2 diabetes?")).toBeNull();
  });
});
