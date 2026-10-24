// Tests for the SEMANTIC BACKSTOP (lib/simplify-semantics.ts) under the STUDY-PINNED,
// HASH-GATED, EXACT-LINE rule. The checklist is server-built; this module re-verifies those
// server questions with the SAME rule construction uses and FAILS CLOSED on any disagreement
// — in particular it no longer accepts a free-text question whose source_criterion merely
// CONTAINS the reviewed substring. Pure functions, no Bedrock.
//
// The three ORIGINAL production regressions and the three REVIEW probes are kept here,
// adapted: each incorrect question is impossible to produce (unknown id) or rejected for a
// structural reason, never accepted.
import { describe, expect, it } from "vitest";
import {
  checkQuestionSemantics,
  detectConditionMismatch,
  evidencePolarity,
  parseAgeSubject,
  hasNegation,
  splitCriteriaSections,
  staffOnlyClassOf,
} from "./simplify-semantics";
import type { SimplifyModel, SimplifyQuestion } from "./bedrock-types";
import type { TrialDetail } from "./types";
import {
  HERO_CRITERIA,
  T1_LINE,
  T2_LINE,
  HOSPICE_LINE,
  heroDetail,
  heroCriteriaWithHospice,
} from "./test-fixtures/nct07043426";

const NCT07043426_CRITERIA = HERO_CRITERIA;

function detailWith(over: Partial<TrialDetail["eligibility"]> = {}): TrialDetail {
  return heroDetail(over);
}
const DETAIL = detailWith();

function model(questions: SimplifyQuestion[], staff_checks: string[] = []): SimplifyModel {
  return { summary: "s", whatYouDo: "w", timeCommitment: "t", questions, staff_checks };
}
const T2DM_DIAGNOSIS_QUOTE = T2_LINE;

// The CORRECT server-built questions (what buildChecklist produces for the hero trial). The
// source_criterion is the ORIGINAL reviewed registry line (bullet stripped).
const GOOD_AGE: SimplifyQuestion = { id: "age_min", text: "Are you at least 18 years old?", ruleOutIf: "no", source_criterion: "minimumAge = 18 years", kind: "inclusion" };
const GOOD_T2: SimplifyQuestion = { id: "t2dm_diagnosis", text: "Do you have type 2 diabetes?", ruleOutIf: "no", source_criterion: T2_LINE, kind: "inclusion" };
const GOOD_T1: SimplifyQuestion = { id: "t1dm_exclusion", text: "Do you have type 1 diabetes?", ruleOutIf: "yes", source_criterion: T1_LINE, kind: "exclusion" };
const GOOD_HOSPICE: SimplifyQuestion = { id: "hospice", text: "Are you currently receiving hospice care?", ruleOutIf: "yes", source_criterion: HOSPICE_LINE, kind: "exclusion" };

// ---------------------------------------------------------------------------
// POSITIVE: the correct server-built hero checklist passes the backstop.
// ---------------------------------------------------------------------------
describe("backstop accepts the correct server-built hero checklist", () => {
  it("accepts age_min + T2DM + T1DM + hospice (en)", () => {
    expect(checkQuestionSemantics(model([GOOD_AGE, GOOD_T2, GOOD_T1, GOOD_HOSPICE]), DETAIL, "en")).toBeNull();
  });
  it("accepts the Spanish localized wording (es)", () => {
    const esT2: SimplifyQuestion = { ...GOOD_T2, text: "¿Tiene diabetes tipo 2?" };
    const esAge: SimplifyQuestion = { ...GOOD_AGE, text: "¿Tiene al menos 18 años?" };
    const esT1: SimplifyQuestion = { ...GOOD_T1, text: "¿Tiene diabetes tipo 1?" };
    const esHos: SimplifyQuestion = { ...GOOD_HOSPICE, text: "¿Está recibiendo cuidados de hospicio (hospice) actualmente?" };
    expect(checkQuestionSemantics(model([esAge, esT2, esT1, esHos]), DETAIL, "es")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FINAL-FIX backstop: study pin + hash + exact-line (the new, stronger gate).
// ---------------------------------------------------------------------------
describe("backstop gates free-text with study-pin + hash + exact-line", () => {
  it("rejects a hospice question whose source_criterion is the NEGATED altered line", () => {
    const altered: SimplifyQuestion = { ...GOOD_HOSPICE, source_criterion: "Patients not currently receiving hospice care." };
    expect(checkQuestionSemantics(model([altered]), DETAIL, "en")).not.toBeNull();
  });
  it("rejects a hospice question whose source_criterion has an extra clause", () => {
    const altered: SimplifyQuestion = { ...GOOD_HOSPICE, source_criterion: "Patients receiving hospice care or palliative care." };
    expect(checkQuestionSemantics(model([altered]), DETAIL, "en")).not.toBeNull();
  });
  it("rejects a question for the WRONG study (nctId not the pinned study)", () => {
    const d = { ...DETAIL, nctId: "NCT99999999" };
    expect(checkQuestionSemantics(model([GOOD_T2]), d, "en")).not.toBeNull();
  });
  it("rejects when the study's criteria hash no longer matches (registry revised)", () => {
    // Keep the three reviewed lines verbatim but edit an UNRELATED line → hash changes.
    const revised = HERO_CRITERIA.replace(
      "* Patients who are deceased",
      "* Patients who are deceased or incarcerated",
    );
    const d = detailWith({ criteriaText: revised });
    // Even though the hospice/T1/T2 lines are untouched and present, the hash mismatch makes
    // every free-text question invalid.
    expect(checkQuestionSemantics(model([GOOD_HOSPICE]), d, "en")).not.toBeNull();
  });
  it("rejects a hospice question when the hospice line itself was replaced (hash + exact-line)", () => {
    const revised = heroCriteriaWithHospice("Patients receiving hospice care or palliative care.");
    const d = detailWith({ criteriaText: revised });
    expect(checkQuestionSemantics(model([GOOD_HOSPICE]), d, "en")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ORIGINAL production regressions (the saved live outputs) — must FAIL CLOSED.
// ---------------------------------------------------------------------------
describe("live NCT07043426 defects are rejected (fail closed)", () => {
  it("DEFECT 1: type-2 question grounded in a TYPE-1 exclusion is rejected", () => {
    const q: SimplifyQuestion = { id: "diabetes_type", text: "Do you have type 2 diabetes?", ruleOutIf: "yes", source_criterion: T1_LINE, kind: "exclusion" };
    expect(checkQuestionSemantics(model([q]), DETAIL, "en")).not.toBeNull();
  });
  it("DEFECT 2: age question citing the DIAGNOSIS paragraph (not structured bounds) is rejected", () => {
    const q: SimplifyQuestion = { id: "age", text: "Are you at least 18 years old?", ruleOutIf: "no", source_criterion: T2DM_DIAGNOSIS_QUOTE, kind: "inclusion" };
    expect(checkQuestionSemantics(model([q]), DETAIL, "en")).not.toBeNull();
  });
  it("DEFECT 3: CCM enrollment asked as a yes/no question is rejected (staff-only)", () => {
    const q: SimplifyQuestion = { id: "ccm_enrollment", text: "Are you enrolled in Complex Care Management?", ruleOutIf: "yes", source_criterion: "Patients enrolled in Complex Care Management (CCM).", kind: "exclusion" };
    const err = checkQuestionSemantics(model([q]), DETAIL, "en");
    expect(err).not.toBeNull();
    expect(err).toMatch(/staff-only|staff_checks|unknown/i);
  });
  it("DEFECT 4: an HbA1c >=9% lab-threshold asked directly (word form) is rejected (staff-only)", () => {
    const q: SimplifyQuestion = { id: "a1c", text: "Is your A1c 9 percent or higher?", ruleOutIf: "no", source_criterion: "Must have an HbA1c ≥9% at the time of screening.", kind: "inclusion" };
    const err = checkQuestionSemantics(model([q]), DETAIL, "en");
    expect(err).not.toBeNull();
    expect(err).toMatch(/staff-only|staff_checks|unknown/i);
  });
});

// ---------------------------------------------------------------------------
// The THREE REVIEW PROBES — permanent, adapted to the new design.
// ---------------------------------------------------------------------------
describe("review probes: structurally impossible / rejected under default-deny", () => {
  it("PROBE 1: asthma subject grounded in diabetes evidence is rejected (unknown mapping id)", () => {
    const unknownId: SimplifyQuestion = { id: "asthma", text: "Do you have asthma?", ruleOutIf: "no", source_criterion: T2_LINE, kind: "inclusion" };
    expect(checkQuestionSemantics(model([unknownId]), DETAIL, "en")).not.toBeNull();
    const wearingT2Id: SimplifyQuestion = { ...GOOD_T2, text: "Do you have asthma?" };
    expect(checkQuestionSemantics(model([wearingT2Id]), DETAIL, "en")).not.toBeNull();
  });
  it("PROBE 2: a negated question is rejected (negation guard), even wearing a valid id", () => {
    const negated: SimplifyQuestion = { ...GOOD_T2, text: "Do you NOT have type 2 diabetes?" };
    const err = checkQuestionSemantics(model([negated]), DETAIL, "en");
    expect(err).not.toBeNull();
    expect(err).toMatch(/negat/i);
  });
  it("PROBE 3: an age question with the wrong polarity is rejected", () => {
    const wrongPolarity: SimplifyQuestion = { ...GOOD_AGE, kind: "exclusion", ruleOutIf: "yes" };
    const err = checkQuestionSemantics(model([wrongPolarity]), DETAIL, "en");
    expect(err).not.toBeNull();
    expect(err).toMatch(/inclusion|ruleOutIf/i);
  });
});

// ---------------------------------------------------------------------------
// Additional required coverage.
// ---------------------------------------------------------------------------
describe("unknown subjects / ids fail closed", () => {
  it("rejects any question whose id is not a supported mapping id", () => {
    const q: SimplifyQuestion = { id: "made_up", text: "Do you like cats?", ruleOutIf: "no", source_criterion: "x", kind: "inclusion" };
    expect(checkQuestionSemantics(model([q]), DETAIL, "en")).not.toBeNull();
  });
});

describe("free-text mapping tampering is rejected", () => {
  it("rejects a T2 question whose kind/ruleOutIf were flipped", () => {
    expect(checkQuestionSemantics(model([{ ...GOOD_T2, kind: "exclusion", ruleOutIf: "yes" }]), DETAIL, "en")).not.toBeNull();
  });
  it("rejects a T2 question whose text is not the mapping wording", () => {
    expect(checkQuestionSemantics(model([{ ...GOOD_T2, text: "Do you have diabetes?" }]), DETAIL, "en")).not.toBeNull();
  });
  it("rejects a T2 question whose evidence was swapped to the T1 line", () => {
    expect(checkQuestionSemantics(model([{ ...GOOD_T2, source_criterion: T1_LINE }]), DETAIL, "en")).not.toBeNull();
  });
});

describe("age polarity + bounds coverage", () => {
  it("rejects an age question that cites the wrong (max) field for a min mapping", () => {
    expect(checkQuestionSemantics(model([{ ...GOOD_AGE, source_criterion: "maximumAge = 18 years" }]), DETAIL, "en")).not.toBeNull();
  });
  it("rejects an age question whose value does not match the study's bound", () => {
    expect(checkQuestionSemantics(model([{ ...GOOD_AGE, text: "Are you at least 21 years old?", source_criterion: "minimumAge = 21 years" }]), DETAIL, "en")).not.toBeNull();
  });
  it("accepts a correct max-age question when the study has a max bound (hash still matches)", () => {
    const d = detailWith({ minAgeYears: null, maxAgeYears: 65 });
    const q: SimplifyQuestion = { id: "age_max", text: "Are you 65 years old or younger?", ruleOutIf: "no", source_criterion: "maximumAge = 65 years", kind: "inclusion" };
    expect(checkQuestionSemantics(model([q, { ...GOOD_T2 }, GOOD_T1]), d, "en")).toBeNull();
  });
  it("rejects a max-age question with a flipped (younger→older) subject vs the mapping", () => {
    const d = detailWith({ minAgeYears: null, maxAgeYears: 65 });
    const q: SimplifyQuestion = { id: "age_max", text: "Are you at least 65 years old?", ruleOutIf: "no", source_criterion: "maximumAge = 65 years", kind: "inclusion" };
    expect(checkQuestionSemantics(model([q]), d, "en")).not.toBeNull();
  });
});

describe("ambiguous / missing section headings never default to inclusion", () => {
  it("rejects a free-text question when there are no headings (hash + section unknown)", () => {
    const d = detailWith({ criteriaText: "Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM). Patients with Type 1 Diabetes Mellitus (T1DM)." });
    expect(checkQuestionSemantics(model([GOOD_T2]), d, "en")).not.toBeNull();
  });
});

describe("staff-only criteria never become questions", () => {
  it("rejects a question whose evidence is CCM enrollment even with a valid-looking id", () => {
    const q: SimplifyQuestion = { ...GOOD_HOSPICE, source_criterion: "Patients enrolled in Complex Care Management (CCM)." };
    expect(checkQuestionSemantics(model([q]), DETAIL, "en")).not.toBeNull();
  });
});

describe("unsupported language for questions fails closed", () => {
  it("rejects when asked to verify a non-en/es language", () => {
    expect(checkQuestionSemantics(model([GOOD_T2]), DETAIL, "pt")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Low-level helpers.
// ---------------------------------------------------------------------------
describe("helpers", () => {
  it("evidencePolarity resolves sections and is unknown off-section (diagnostic helper)", () => {
    expect(evidencePolarity(T2_LINE, NCT07043426_CRITERIA)).toBe("inclusion");
    expect(evidencePolarity(T1_LINE, NCT07043426_CRITERIA)).toBe("exclusion");
    expect(evidencePolarity("not in the text at all", NCT07043426_CRITERIA)).toBe("unknown");
  });
  it("splitCriteriaSections back-compat view returns strings", () => {
    const s = splitCriteriaSections(NCT07043426_CRITERIA);
    expect(s.inclusion).toContain("type 2 diabetes");
    expect(s.exclusion).toContain("type 1 diabetes");
  });
  it("hasNegation catches English + Spanish negations", () => {
    expect(hasNegation("Do you NOT have type 2 diabetes?")).toBe(true);
    expect(hasNegation("¿No tiene diabetes tipo 2?")).toBe(true);
    expect(hasNegation("Do you have type 2 diabetes?")).toBe(false);
    expect(hasNegation("¿Tiene diabetes tipo 2?")).toBe(false);
  });
  it("parseAgeSubject reads bounds in en and es", () => {
    expect(parseAgeSubject("Are you at least 18 years old?")).toEqual({ value: 18, bound: "min" });
    expect(parseAgeSubject("Are you 65 years old or younger?")).toEqual({ value: 65, bound: "max" });
    expect(parseAgeSubject("¿Tiene al menos 18 años?")).toEqual({ value: 18, bound: "min" });
    expect(parseAgeSubject("Do you have type 2 diabetes?")).toBeNull();
  });
  it("detectConditionMismatch flags T2 question vs T1 evidence", () => {
    expect(detectConditionMismatch("Do you have type 2 diabetes?", T1_LINE)).not.toBeNull();
    expect(detectConditionMismatch("Do you have type 2 diabetes?", T2_LINE)).toBeNull();
  });
  it("staffOnlyClassOf flags CCM and A1c threshold text", () => {
    expect(staffOnlyClassOf("Are you enrolled in Complex Care Management?")).toBe("care_management_enrollment");
    expect(staffOnlyClassOf("Is your A1c 9 percent or higher?")).toBe("lab_cutoff_from_record");
  });
});
