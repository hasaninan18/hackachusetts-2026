// Tests for the DEFAULT-DENY mapping registry (lib/simplify-mappings.ts). Pure, no Bedrock.
// These prove the SERVER builds the checklist deterministically and fails closed on anything
// it does not explicitly support.
import { describe, expect, it } from "vitest";
import type { TrialDetail } from "./types";
import type { Lang } from "./types";
import {
  buildChecklist,
  splitSections,
  hasQuestionWording,
  evidenceIsNegated,
  MIN_SUPPORTED_QUESTIONS,
} from "./simplify-mappings";

const HERO_CRITERIA = [
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

function detail(over: Partial<TrialDetail["eligibility"]> = {}): TrialDetail {
  return {
    nctId: "NCT07043426",
    title: "T",
    conditions: [],
    phase: null,
    nearestSite: { name: "BMC", city: "Boston", lat: 0, lon: 0, locationPrecision: "facility" },
    distanceMi: 0,
    briefSummary: "",
    eligibility: { minAgeYears: 18, maxAgeYears: null, sex: "ALL", healthyVolunteers: false, criteriaText: HERO_CRITERIA, ...over },
    sites: [],
    contacts: [],
    stops: [],
  };
}

describe("splitSections — explicit headings only, fail closed", () => {
  it("splits inclusion/exclusion when both headings are present and ordered", () => {
    const s = splitSections(HERO_CRITERIA);
    expect(s.inclusion).not.toBeNull();
    expect(s.exclusion).not.toBeNull();
    expect(s.inclusion).toContain("type 2 diabetes");
    expect(s.exclusion).toContain("type 1 diabetes");
  });
  it("returns null sections when there are NO headings (never defaults to inclusion)", () => {
    const s = splitSections("Must have type 2 diabetes. Patients in hospice.");
    expect(s.inclusion).toBeNull();
    expect(s.exclusion).toBeNull();
  });
  it("returns null sections when headings are duplicated (ambiguous)", () => {
    const s = splitSections("Inclusion Criteria:\nX\nInclusion Criteria:\nY\nExclusion Criteria:\nZ");
    expect(s.inclusion).toBeNull();
    expect(s.exclusion).toBeNull();
  });
  it("returns null sections when exclusion appears before inclusion (ambiguous order)", () => {
    const s = splitSections("Exclusion Criteria:\nZ\nInclusion Criteria:\nX");
    expect(s.inclusion).toBeNull();
    expect(s.exclusion).toBeNull();
  });
});

describe("hasQuestionWording", () => {
  it("is true only for en/es", () => {
    expect(hasQuestionWording("en")).toBe(true);
    expect(hasQuestionWording("es")).toBe(true);
    for (const l of ["pt", "ht", "zh", "vi"] as Lang[]) expect(hasQuestionWording(l)).toBe(false);
  });
});

describe("buildChecklist — hero trial", () => {
  it("builds age_min + T2DM + T1DM + hospice in English", () => {
    const r = buildChecklist(detail(), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.questions.map((q) => [q.id, q]));
    expect([...byId.keys()].sort()).toEqual(["age_min", "hospice", "t1dm_exclusion", "t2dm_diagnosis"]);
    // T2DM inclusion, rule-out on "no"; evidence is the VERBATIM registry line.
    const t2 = byId.get("t2dm_diagnosis")!;
    expect(t2.kind).toBe("inclusion");
    expect(t2.ruleOutIf).toBe("no");
    expect(t2.source_criterion).toContain("Type 2 Diabetes Mellitus (T2DM)");
    // T1DM exclusion, rule-out on "yes"; distinct fact.
    const t1 = byId.get("t1dm_exclusion")!;
    expect(t1.kind).toBe("exclusion");
    expect(t1.ruleOutIf).toBe("yes");
    expect(t1.source_criterion).toContain("Type 1 Diabetes Mellitus (T1DM)");
    // Age min from the structured bound, inclusion / "no".
    const age = byId.get("age_min")!;
    expect(age.kind).toBe("inclusion");
    expect(age.ruleOutIf).toBe("no");
    expect(age.source_criterion).toBe("minimumAge = 18 years");
  });

  it("localizes question wording to Spanish while keeping rule-out logic", () => {
    const r = buildChecklist(detail(), "es");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.questions.map((q) => [q.id, q]));
    expect(byId.get("t2dm_diagnosis")!.text).toBe("¿Tiene diabetes tipo 2?");
    expect(byId.get("t2dm_diagnosis")!.ruleOutIf).toBe("no");
    expect(byId.get("age_min")!.text).toBe("¿Tiene al menos 18 años?");
    // source_criterion (evidence) is identical to English — it is the registry quote.
    const en = buildChecklist(detail(), "en");
    if (!en.ok) return;
    const enT2 = en.questions.find((q) => q.id === "t2dm_diagnosis")!;
    expect(byId.get("t2dm_diagnosis")!.source_criterion).toBe(enT2.source_criterion);
  });
});

describe("buildChecklist — fails closed", () => {
  it("rejects unsupported languages", () => {
    for (const l of ["pt", "ht", "zh", "vi"] as Lang[]) {
      expect(buildChecklist(detail(), l).ok).toBe(false);
    }
  });

  it("emits NO age question when the bound is missing, and falls to free-text only", () => {
    const r = buildChecklist(detail({ minAgeYears: null, maxAgeYears: null }), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.questions.some((q) => q.id.startsWith("age"))).toBe(false);
    // Still has the three diabetes/hospice mappings.
    expect(r.questions.length).toBeGreaterThanOrEqual(MIN_SUPPORTED_QUESTIONS);
  });

  it("emits NO age question when bounds conflict (min > max)", () => {
    const r = buildChecklist(detail({ minAgeYears: 70, maxAgeYears: 30 }), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.questions.some((q) => q.id.startsWith("age"))).toBe(false);
  });

  it("emits NO age question for a non-finite / absurd bound", () => {
    const r1 = buildChecklist(detail({ minAgeYears: Number.NaN as unknown as number }), "en");
    if (r1.ok) expect(r1.questions.some((q) => q.id === "age_min")).toBe(false);
    const r2 = buildChecklist(detail({ minAgeYears: 999 }), "en");
    if (r2.ok) expect(r2.questions.some((q) => q.id === "age_min")).toBe(false);
  });

  it("builds a max-age question with the correct wording/polarity", () => {
    const r = buildChecklist(detail({ minAgeYears: null, maxAgeYears: 65 }), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const age = r.questions.find((q) => q.id === "age_max");
    expect(age).toBeDefined();
    expect(age!.text).toBe("Are you 65 years old or younger?");
    expect(age!.kind).toBe("inclusion");
    expect(age!.ruleOutIf).toBe("no");
    expect(age!.source_criterion).toBe("maximumAge = 65 years");
  });

  it("does NOT fire the T2DM mapping when there is no inclusion heading", () => {
    const noHeadings = "Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM). Patients with Type 1 Diabetes Mellitus (T1DM).";
    const r = buildChecklist(detail({ minAgeYears: null, criteriaText: noHeadings }), "en");
    // No headings -> no free-text mappings -> only the (absent) age -> too few -> error.
    expect(r.ok).toBe(false);
  });

  it("keeps T1 and T2 strictly distinct (neither satisfies the other)", () => {
    // Criteria that mention only T1 in the inclusion section must NOT produce a T2 question.
    const t1Inc = [
      "Inclusion Criteria:",
      "* Must have a diagnosis of Type 1 Diabetes Mellitus (T1DM).",
      "Exclusion Criteria:",
      "* Patients receiving hospice care.",
    ].join("\n");
    const r = buildChecklist(detail({ minAgeYears: 18, criteriaText: t1Inc }), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // T2DM mapping requires the T2 fact in the INCLUSION section — absent here.
    expect(r.questions.some((q) => q.id === "t2dm_diagnosis")).toBe(false);
    // T1DM mapping requires the T1 fact in the EXCLUSION section — absent here (T1 is inclusion).
    expect(r.questions.some((q) => q.id === "t1dm_exclusion")).toBe(false);
  });

  it("never turns a staff-only / compound / lab criterion into a question", () => {
    const r = buildChecklist(detail(), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const texts = r.questions.map((q) => q.text.toLowerCase()).join(" | ");
    expect(texts).not.toContain("hba1c");
    expect(texts).not.toContain("care management");
    expect(texts).not.toContain("social need");
    expect(texts).not.toContain("deceased");
    expect(r.questions.some((q) => q.id === "ccm")).toBe(false);
  });
  it("does NOT fire a mapping whose required fact is in the WRONG section", () => {
    // Put the T1DM fact in the INCLUSION section (not exclusion). The t1dm_exclusion mapping
    // requires it in the EXCLUSION section, so it must not fire. The t2dm_diagnosis mapping
    // (T2 in inclusion) + hospice (exclusion) still stand.
    const swapped = [
      "Inclusion Criteria:",
      "* Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM).",
      "* Patients with Type 1 Diabetes Mellitus (T1DM).",
      "Exclusion Criteria:",
      "* Patients receiving hospice care.",
    ].join("\n");
    const r = buildChecklist(detail({ minAgeYears: 18, criteriaText: swapped }), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // T1DM is in the wrong (inclusion) section -> the exclusion mapping does not fire.
    expect(r.questions.some((q) => q.id === "t1dm_exclusion")).toBe(false);
    // T2DM (inclusion) and hospice (exclusion) are correctly placed and do fire.
    expect(r.questions.some((q) => q.id === "t2dm_diagnosis")).toBe(true);
    expect(r.questions.some((q) => q.id === "hospice")).toBe(true);
  });
  it("returns a safe error when FEWER than MIN_SUPPORTED_QUESTIONS can be built", () => {
    // Only hospice (one exclusion fact) and no usable age bound -> 1 question < floor(2).
    const thin = [
      "Inclusion Criteria:",
      "* Must be able to attend visits.",
      "Exclusion Criteria:",
      "* Patients receiving hospice care.",
    ].join("\n");
    const r = buildChecklist(detail({ minAgeYears: null, maxAgeYears: null, criteriaText: thin }), "en");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/minimum is 2|supported question/i);
  });
  it("does NOT fire on a compound / negated criterion that has no mapping", () => {
    // A compound inclusion ("screened AND positive during a GIM visit") and a negated
    // phrasing ("No history of ...") have no supported mapping, so they contribute nothing;
    // with no other supported facts the study fails closed.
    const compound = [
      "Inclusion Criteria:",
      "* Must have been screened for HRSNs during a GIM visit and screened positive for at least one HRSN.",
      "* No history of type 2 diabetes mellitus (T2DM) in the last year.",
      "Exclusion Criteria:",
      "* Patients who are deceased.",
    ].join("\n");
    const r = buildChecklist(detail({ minAgeYears: null, maxAgeYears: null, criteriaText: compound }), "en");
    // Nothing supported (compound HRSN, a negated T2 line, a staff-only 'deceased') -> error.
    expect(r.ok).toBe(false);
  });
  it("does NOT fire a mapping on a NEGATED evidence line (presence vs absence)", () => {
    // "No history of type 2 diabetes" in the inclusion section must NOT yield a positive
    // "Do you have type 2 diabetes?" question — that would invert the criterion's meaning.
    const negated = [
      "Inclusion Criteria:",
      "* No history of type 2 diabetes mellitus (T2DM) in the last year.",
      "Exclusion Criteria:",
      "* Patients receiving hospice care.",
    ].join("\n");
    const r = buildChecklist(detail({ minAgeYears: 18, criteriaText: negated }), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The negated T2 line is skipped; only age_min + hospice survive.
    expect(r.questions.some((q) => q.id === "t2dm_diagnosis")).toBe(false);
    expect(r.questions.map((q) => q.id).sort()).toEqual(["age_min", "hospice"]);
  });
  it("evidenceIsNegated flags negated lines but not the real T2 diagnosis line", () => {
    expect(evidenceIsNegated("No history of type 2 diabetes mellitus (T2DM).")).toBe(true);
    expect(evidenceIsNegated("Patients without type 1 diabetes.")).toBe(true);
    expect(evidenceIsNegated("Sin diabetes tipo 2.")).toBe(true);
    expect(
      evidenceIsNegated(
        "Diagnosis: Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM), confirmed by a current diagnosis in the medical record or at least two billing codes in the last two years, or an HbA1c level \u22656.5% in the last two years.",
      ),
    ).toBe(false);
  });
});
