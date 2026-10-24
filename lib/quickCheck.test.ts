import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INFO_REASONS, quickCheck, type Answer, type Profile } from "./quickCheck";
import type { Eligibility, FitQuestion } from "./types";

// Real criteria text (NCT05799222, abridged).
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

// The structured checks (age, sex, healthy volunteer) are shown on their own here, so each
// example asks one question answered "not sure", which never rules anyone out. With no
// questions at all, the check adds an info reason instead (see the last describe block).
const ONE: FitQuestion[] = [{ id: "q0", text: "Any other rule?", ruleOutIf: "yes" }];
const UNSURE: Record<string, Answer> = { q0: "unsure" };
const structured = (p: Profile, e: Eligibility) => quickCheck(p, e, ONE, UNSURE);
const unsureFor = (qs: FitQuestion[]) => Object.fromEntries(qs.map((q) => [q.id, "unsure" as Answer]));

describe("quickCheck examples", () => {
  it("Maria (52, has diabetes, no other medicine) is a possible fit", () => {
    const r = quickCheck({ age: 52, healthy: false }, mgh, questions, { q1: "yes", q2: "no" });
    expect(r).toEqual({ outcome: "possible-fit", reasons: [] });
  });

  it("age boundaries are inclusive", () => {
    expect(structured({ age: 18 }, mgh).outcome).toBe("possible-fit");
    expect(structured({ age: 65 }, mgh).outcome).toBe("possible-fit");
    expect(structured({ age: 17 }, mgh).reasons).toEqual([{ kind: "age-too-young" }]);
    expect(structured({ age: 66 }, mgh).reasons).toEqual([{ kind: "age-too-old" }]);
  });

  it("a healthy volunteer is flagged only when the study doesn't accept them", () => {
    expect(structured({ healthy: true }, mgh).reasons).toEqual([{ kind: "healthy-volunteer" }]);
    expect(structured({ healthy: true }, { ...mgh, healthyVolunteers: true }).outcome).toBe("possible-fit");
  });

  it("sex mismatch is flagged only for single-sex studies", () => {
    const womenOnly = { ...mgh, sex: "FEMALE" as const };
    expect(structured({ sex: "MALE" }, womenOnly).reasons).toEqual([{ kind: "sex" }]);
    expect(structured({ sex: "FEMALE" }, womenOnly).outcome).toBe("possible-fit");
    expect(structured({ sex: "MALE" }, mgh).outcome).toBe("possible-fit");
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

const questionArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 4 }),
  text: fc.string(),
  ruleOutIf: fc.constantFrom("yes", "no" as const),
});
const questionsArb = fc.uniqueArray(questionArb, { maxLength: 6, selector: (q) => q.id });
const someQuestionsArb = fc.uniqueArray(questionArb, { minLength: 1, maxLength: 6, selector: (q) => q.id });

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
      fc.property(eligibilityArb, someQuestionsArb, (e, qs) => {
        expect(quickCheck({}, e, qs, unsureFor(qs)).outcome).toBe("possible-fit");
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

// .kiro/specs/fit-check Requirement 7, widened by docs/TASKS.md (14:18): with no generated
// questions, age, sex and condition alone must not give the positive "possible fit".
describe("no generated questions -> never possible-fit (cautious fallback)", () => {
  const empty: Eligibility = {
    minAgeYears: null,
    maxAgeYears: null,
    sex: "ALL",
    healthyVolunteers: true,
    criteriaText: "",
  };

  it("empty criteria with no questions is ask-team with insufficient-info", () => {
    const r = quickCheck({}, empty, [], {});
    expect(r).toEqual({ outcome: "ask-team", reasons: [{ kind: "insufficient-info" }] });
  });

  it("whitespace-only and symbols-only criteria count as empty", () => {
    for (const criteriaText of ["   \n\t ", "--- / . , ; ***"]) {
      expect(quickCheck({}, { ...empty, criteriaText }, [], {}).reasons).toEqual([{ kind: "insufficient-info" }]);
    }
  });

  it("a missing criteriaText (malformed response) is treated as empty, never a crash", () => {
    const malformed = { ...empty, criteriaText: undefined } as unknown as Eligibility;
    expect(quickCheck({}, malformed, [], {}).reasons).toEqual([{ kind: "insufficient-info" }]);
  });

  it("criteria text but no questions (model failed or made none) is ask-team, not a fit from age alone", () => {
    const r = quickCheck({ age: 52, healthy: false }, mgh, [], {});
    expect(r).toEqual({ outcome: "ask-team", reasons: [{ kind: "unchecked-criteria" }] });
  });

  it("counts letters and digits in any script as criteria content", () => {
    for (const criteriaText of ["年龄18岁以上", "Tuổi từ 18", "٣", "x"]) {
      expect(quickCheck({}, { ...empty, criteriaText }, [], {}).reasons).toEqual([{ kind: "unchecked-criteria" }]);
    }
  });

  it("with questions there is no info reason, so answering everything stays possible-fit", () => {
    const qs: FitQuestion[] = [{ id: "q1", text: "…", ruleOutIf: "no" }];
    expect(quickCheck({}, empty, qs, { q1: "yes" })).toEqual({ outcome: "possible-fit", reasons: [] });
  });

  it("keeps structured reasons alongside the info reason", () => {
    expect(quickCheck({ age: 10 }, { ...empty, minAgeYears: 18 }, [], {}).reasons).toEqual([
      { kind: "age-too-young" },
      { kind: "insufficient-info" },
    ]);
    expect(quickCheck({ age: 10 }, mgh, [], {}).reasons).toEqual([
      { kind: "age-too-young" },
      { kind: "unchecked-criteria" },
    ]);
  });

  it("exactly one info reason iff there are no questions, picked by whether the text has a letter or digit", () => {
    const textArb = fc.oneof(
      fc.constant(""),
      fc.constantFrom(" ", "\n\t", "--- / . , ;", "***", "•"),
      fc.string(),
      fc.string({ unit: "binary" }),
    );
    fc.assert(
      fc.property(profileArb, eligibilityArb, textArb, questionsArb, (p, e, criteriaText, qs) => {
        const r = quickCheck(p, { ...e, criteriaText }, qs, unsureFor(qs));
        const info = r.reasons.filter((x) => INFO_REASONS.includes(x.kind));
        if (qs.length > 0) {
          expect(info).toEqual([]);
        } else {
          const kind = /[\p{L}\p{N}]/u.test(criteriaText) ? "unchecked-criteria" : "insufficient-info";
          expect(info).toEqual([{ kind }]);
          expect(r.outcome).toBe("ask-team");
        }
      }),
    );
  });
});
