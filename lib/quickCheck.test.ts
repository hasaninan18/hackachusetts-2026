import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quickCheck, type Answer, type Profile } from "./quickCheck";
import type { Eligibility, FitQuestion } from "./types";

const mgh: Eligibility = {
  minAgeYears: 18,
  maxAgeYears: 65,
  sex: "ALL",
  healthyVolunteers: false,
  criteriaText: "",
};

const questions: FitQuestion[] = [
  { id: "q1", text: "Diabetes or prediabetes?", ruleOutIf: "no" },
  { id: "q2", text: "Other blood sugar medicine?", ruleOutIf: "yes" },
];

describe("quickCheck examples", () => {
  it("Maria (52, has diabetes, no other medicine) is a possible fit", () => {
    const r = quickCheck({ age: 52, healthy: false }, mgh, questions, { q1: "yes", q2: "no" });
    expect(r).toEqual({ outcome: "possible-fit", reasons: [] });
  });

  it("age boundaries are inclusive", () => {
    expect(quickCheck({ age: 18 }, mgh, [], {}).outcome).toBe("possible-fit");
    expect(quickCheck({ age: 65 }, mgh, [], {}).outcome).toBe("possible-fit");
    expect(quickCheck({ age: 17 }, mgh, [], {}).reasons).toEqual([{ kind: "age-too-young" }]);
    expect(quickCheck({ age: 66 }, mgh, [], {}).reasons).toEqual([{ kind: "age-too-old" }]);
  });

  it("a healthy volunteer is flagged only when the study doesn't accept them", () => {
    expect(quickCheck({ healthy: true }, mgh, [], {}).reasons).toEqual([{ kind: "healthy-volunteer" }]);
    expect(quickCheck({ healthy: true }, { ...mgh, healthyVolunteers: true }, [], {}).outcome).toBe(
      "possible-fit",
    );
  });

  it("sex mismatch is flagged only for single-sex studies", () => {
    const womenOnly = { ...mgh, sex: "FEMALE" as const };
    expect(quickCheck({ sex: "MALE" }, womenOnly, [], {}).reasons).toEqual([{ kind: "sex" }]);
    expect(quickCheck({ sex: "FEMALE" }, womenOnly, [], {}).outcome).toBe("possible-fit");
    expect(quickCheck({ sex: "MALE" }, mgh, [], {}).outcome).toBe("possible-fit");
  });

  it("an answer matching ruleOutIf is reported with its question id", () => {
    const r = quickCheck({}, mgh, questions, { q1: "no", q2: "yes" });
    expect(r.outcome).toBe("ask-team");
    expect(r.reasons).toEqual([
      { kind: "answer", questionId: "q1" },
      { kind: "answer", questionId: "q2" },
    ]);
  });
});

const eligibilityArb: fc.Arbitrary<Eligibility> = fc
  .record({
    a: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    b: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    sex: fc.constantFrom("ALL", "FEMALE", "MALE" as const),
    healthyVolunteers: fc.boolean(),
  })
  .map(({ a, b, sex, healthyVolunteers }) => ({
    minAgeYears: a !== null && b !== null ? Math.min(a, b) : a,
    maxAgeYears: a !== null && b !== null ? Math.max(a, b) : b,
    sex,
    healthyVolunteers,
    criteriaText: "",
  }));

const profileArb: fc.Arbitrary<Profile> = fc.record(
  {
    age: fc.integer({ min: 0, max: 120 }),
    sex: fc.constantFrom("FEMALE", "MALE" as const),
    healthy: fc.boolean(),
  },
  { requiredKeys: [] },
);

const questionsArb = fc.uniqueArray(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 4 }),
    text: fc.string(),
    ruleOutIf: fc.constantFrom("yes", "no" as const),
  }),
  { maxLength: 6, selector: (q) => q.id },
);

describe("quickCheck properties", () => {
  it("only ever returns the two allowed outcomes, and ask-team iff there are reasons", () => {
    fc.assert(
      fc.property(profileArb, eligibilityArb, questionsArb, (p, e, qs) => {
        const answers = Object.fromEntries(qs.map((q) => [q.id, "yes" as Answer]));
        const r = quickCheck(p, e, qs, answers);
        expect(["possible-fit", "ask-team"]).toContain(r.outcome);
        expect(r.outcome === "ask-team").toBe(r.reasons.length > 0);
      }),
    );
  });

  it("'not sure' answers and an empty profile never rule anyone out", () => {
    fc.assert(
      fc.property(eligibilityArb, questionsArb, (e, qs) => {
        const unsure = Object.fromEntries(qs.map((q) => [q.id, "unsure" as Answer]));
        expect(quickCheck({}, e, qs, unsure).outcome).toBe("possible-fit");
      }),
    );
  });

  it("changing an answer to 'not sure' never makes the result stricter", () => {
    fc.assert(
      fc.property(
        profileArb,
        eligibilityArb,
        questionsArb,
        fc.array(fc.constantFrom<Answer>("yes", "no", "unsure"), { maxLength: 6 }),
        (p, e, qs, picks) => {
          const answers = Object.fromEntries(qs.map((q, i) => [q.id, picks[i] ?? "unsure"]));
          const before = quickCheck(p, e, qs, answers).reasons.length;
          for (const q of qs) {
            const after = quickCheck(p, e, qs, { ...answers, [q.id]: "unsure" }).reasons.length;
            expect(after).toBeLessThanOrEqual(before);
          }
        },
      ),
    );
  });
});
