import fc from "fast-check";
import { describe, expect, it } from "vitest";
import mgh from "./mock/ctgov/NCT05799222.json";
import bwh from "./mock/ctgov/NCT06138821.json";
import { extractStudyFacts } from "./studyFacts";

// Fixtures are real ClinicalTrials.gov API v2 responses (fetched 2026-10-24).
describe("extractStudyFacts on real records", () => {
  it("NCT06138821 (Brigham): randomized, open-label, 2 arms, no placebo", () => {
    const f = extractStudyFacts(bwh);
    expect(f.studyType).toBe("INTERVENTIONAL");
    expect(f.randomized).toBe(true);
    expect(f.masking).toBe("NONE");
    expect(f.hasPlacebo).toBe(false);
    expect(f.arms.map((a) => [a.label, a.type])).toEqual([
      ["ESG + lifestyle modification", "EXPERIMENTAL"],
      ["Lifestyle modification", "ACTIVE_COMPARATOR"],
    ]);
    expect(f.interventions).toEqual(["Device: ESG + lifestyle modification", "Behavioral: Lifestyle modification"]);
    expect(f.primaryOutcomes).toEqual([
      { measure: "MASH resolution without worsening of liver fibrosis at 12 months", timeFrame: "Baseline, 12 months" },
    ]);
    expect(f.secondaryOutcomeCount).toBe(22);
    expect(f.enrollment).toEqual({ count: 132, estimated: true });
    expect(f.start).toEqual({ date: "2025-06-24", estimated: false });
    expect(f.completion).toEqual({ date: "2028-06", estimated: true });
    expect(f.collaborators).toEqual([
      { name: "Boston Scientific Corporation", industry: true },
      { name: "Cook Group Incorporated", industry: true },
    ]);
  });

  it("NCT05799222 (MGH): observational, measured at 3 months, ~20 people", () => {
    const f = extractStudyFacts(mgh);
    expect(f.studyType).toBe("OBSERVATIONAL");
    expect(f.randomized).toBeNull();
    expect(f.masking).toBeNull();
    expect(f.primaryOutcomes.map((o) => o.timeFrame)).toEqual(["3 months", "3 months"]);
    expect(f.enrollment).toEqual({ count: 20, estimated: true });
    expect(f.sponsor).toBe("Massachusetts General Hospital");
    expect(f.collaborators).toEqual([]);
  });
});

describe("extractStudyFacts robustness", () => {
  it("never throws on arbitrary JSON and always returns arrays", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const f = extractStudyFacts({ protocolSection: v });
        expect(Array.isArray(f.arms)).toBe(true);
        expect(Array.isArray(f.primaryOutcomes)).toBe(true);
        expect(Array.isArray(f.collaborators)).toBe(true);
        expect(typeof f.hasPlacebo).toBe("boolean");
      }),
    );
  });

  it("detects a placebo arm or a placebo intervention", () => {
    const withArm = { protocolSection: { armsInterventionsModule: { armGroups: [{ label: "B", type: "PLACEBO_COMPARATOR" }] } } };
    const withDrug = { protocolSection: { armsInterventionsModule: { interventions: [{ type: "DRUG", name: "Matching Placebo" }] } } };
    expect(extractStudyFacts(withArm).hasPlacebo).toBe(true);
    expect(extractStudyFacts(withDrug).hasPlacebo).toBe(true);
  });

  it("rejects malformed dates", () => {
    const s = { protocolSection: { statusModule: { startDateStruct: { date: "soon", type: "ACTUAL" } } } };
    expect(extractStudyFacts(s).start).toBeNull();
  });
});
