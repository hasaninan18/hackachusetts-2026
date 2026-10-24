import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quickCheck, type Answer, type Profile } from "./quickCheck";
import type { Eligibility, FitQuestion } from "./types";

// Real criteria text (NCT05799222, abridged). With no text and no questions the check now
// reports insufficient-info, so the structured-check examples below need a study that has text.
const CRITERIA = "Inclusion Criteria:\n\n* Age 18-65\n* Body mass index (BMI) greater than or equal to 27 kg/m^2";

const mgh: Eligibility = {
  minAgeYears: 18,
  maxAgeYears: 65,
  sex: "ALL",
  healthyVolunteers: false,
  criteriaText: CRITERIA,
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
    criteriaText: CRITERIA,
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

// .kiro/specs/fit-check Requirement 7 (design "Proposed change for the owner", Change 5).
describe("insufficient-info (empty criteria, no questions) -> ask-team", () => {
  const empty: Eligibility = {
    minAgeYears: null,
    maxAgeYears: null,
    sex: "ALL",
    healthyVolunteers: true,
    criteriaText: "",
  };

  it("empty criteria with no questions is ask-team, not possible-fit", () => {
    const r = quickCheck({}, empty, [], {});
    expect(r.outcome).toBe("ask-team");
    expect(r.reasons).toEqual([{ kind: "insufficient-info" }]);
  });

  it("whitespace-only criteria with no questions is ask-team", () => {
    const r = quickCheck({}, { ...empty, criteriaText: "   \n\t " }, [], {});
    expect(r.outcome).toBe("ask-team");
    expect(r.reasons.some((x) => x.kind === "insufficient-info")).toBe(true);
  });

  it("symbols/punctuation-only criteria with no questions is ask-team", () => {
    const r = quickCheck({}, { ...empty, criteriaText: "--- / . , ; ***" }, [], {});
    expect(r.outcome).toBe("ask-team");
    expect(r.reasons.some((x) => x.kind === "insufficient-info")).toBe(true);
  });

  it("a missing criteriaText (malformed response) is treated as empty, never a crash", () => {
    const malformed = { ...empty, criteriaText: undefined } as unknown as Eligibility;
    expect(quickCheck({}, malformed, [], {}).reasons).toEqual([{ kind: "insufficient-info" }]);
  });

  it("does NOT fire when there is at least one question (case A stays possible-fit)", () => {
    const qs: FitQuestion[] = [{ id: "q1", text: "…", ruleOutIf: "no" }];
    const r = quickCheck({}, empty, qs, { q1: "yes" });
    expect(r.outcome).toBe("possible-fit");
    expect(r.reasons).toEqual([]);
  });

  it("does NOT fire when criteria text has letters/digits even if no questions were generated", () => {
    // Also the tech.md LLM-failure fallback: structured checks only, criteria text still present.
    const r = quickCheck({}, { ...empty, criteriaText: "Must be 18 or older." }, [], {});
    expect(r.reasons.some((x) => x.kind === "insufficient-info")).toBe(false);
    expect(r.outcome).toBe("possible-fit");
  });

  it("counts letters and digits in any script as content", () => {
    for (const text of ["年龄18岁以上", "Tuổi từ 18", "٣", "x"]) {
      expect(quickCheck({}, { ...empty, criteriaText: text }, [], {}).outcome).toBe("possible-fit");
    }
  });

  it("keeps structured reasons alongside it", () => {
    const r = quickCheck({ age: 10 }, { ...empty, minAgeYears: 18 }, [], {});
    expect(r.reasons).toEqual([{ kind: "age-too-young" }, { kind: "insufficient-info" }]);
  });

  it("fires exactly when there are no questions and the text has no letter or digit", () => {
    const textArb = fc.oneof(
      fc.constant(""),
      fc.constantFrom(" ", "\n\t", "--- / . , ;", "***", "•"),
      fc.string(),
      fc.string({ unit: "binary" }),
    );
    fc.assert(
      fc.property(profileArb, eligibilityArb, textArb, questionsArb, (p, e, criteriaText, qs) => {
        const answers = Object.fromEntries(qs.map((q) => [q.id, "unsure" as Answer]));
        const r = quickCheck(p, { ...e, criteriaText }, qs, answers);
        const expected = qs.length === 0 && !/[\p{L}\p{N}]/u.test(criteriaText);
        expect(r.reasons.some((x) => x.kind === "insufficient-info")).toBe(expected);
        if (expected) expect(r.outcome).toBe("ask-team");
      }),
    );
  });
});
