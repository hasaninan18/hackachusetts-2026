// Scope rules added after the first independent review of PR #35 (requirements R2.4, R2.5,
// R2.8, R3.4). The reviewer's four exact cases live in english-requirement.review.test.ts;
// these tests check the GENERAL rules with other wording, plus controls that must still flag.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectEnglishRequirement } from "./english-requirement";

const inc = (...lines: string[]) => `Inclusion Criteria:\n\n${lines.map((l) => `* ${l}`).join("\n")}`;
const exc = (...lines: string[]) => `Exclusion Criteria:\n\n${lines.map((l) => `* ${l}`).join("\n")}`;

describe("inability words count as negation (R2.5)", () => {
  it.each(["Illiterate in English", "English illiteracy", "Non-fluent in English", "Nonfluent English speaker"])(
    "inclusion '%s' is not required",
    (line) => {
      expect(detectEnglishRequirement(inc(line)).status).not.toBe("required");
    },
  );
  it.each(["Illiterate in English", "Non-fluent in English"])("exclusion '%s' is a requirement", (line) => {
    expect(detectEnglishRequirement(exc(line))).toEqual({ status: "required", evidence: [line] });
  });
});

describe("a negation must be bound to the English ability (R2.5)", () => {
  it.each([
    "English-speaking patients without prior surgery",
    "English-speaking adults with no history of stroke",
    "English speakers with no prior treatment",
    "Fluent English speakers; no prior chemotherapy",
    "Speaks English. Not pregnant.",
    "English-speaking participants who have not received radiation",
  ])("exclusion '%s' is not required", (line) => {
    expect(detectEnglishRequirement(exc(line)).status).not.toBe("required");
  });

  it.each([
    "Unable to speak English",
    "Non-English speaking",
    "Does not speak English",
    "Cannot read English",
    "Not proficient in English",
    "Inability to comprehend English",
    "English proficiency is limited",
    "Language other than English",
  ])("exclusion control '%s' is still required", (line) => {
    expect(detectEnglishRequirement(exc(line))).toEqual({ status: "required", evidence: [line] });
  });

  it("known miss (fails closed): a long gap between the negation and English is unclear", () => {
    const line = "Patients unable, due to cognitive or hearing impairment, to speak English";
    expect(detectEnglishRequirement(exc(line))).toEqual({ status: "mentioned", reason: "unclear" });
  });

  it("inclusion stays strict: any negation anywhere on the line is unclear", () => {
    expect(detectEnglishRequirement(inc("English speaking, no prior treatment"))).toEqual({
      status: "mentioned",
      reason: "unclear",
    });
  });
});

describe("the ability word must be about English, in the same clause (R2.8)", () => {
  it.each([
    "Able to walk 50 meters. Questionnaires are in English.",
    "Able to attend all visits and study materials are written in English",
    "Ability to swallow pills; consent forms are in English",
    "Reads the newspaper daily. Lives in an English-majority household.",
  ])("inclusion '%s' is not required", (line) => {
    expect(detectEnglishRequirement(inc(line))).toEqual({ status: "mentioned", reason: "unclear" });
  });

  it.each(["Must speak English", "Able to read and understand English", "Comfortable conversing in English"])(
    "inclusion control '%s' is still required",
    (line) => {
      expect(detectEnglishRequirement(inc(line))).toEqual({ status: "required", evidence: [line] });
    },
  );
});

describe("vetoes before the first heading are study-wide (R3.4)", () => {
  it.each([
    "Spanish or English speakers may enroll.",
    "Consent forms are translated from English for all participants.",
    "Non-English speakers are welcome.",
    "Participants who do not speak English may participate.",
  ])("preamble '%s' vetoes a later requirement", (preamble) => {
    const text = `${preamble}\n\n${inc("Must speak English")}\n\n${exc("Unable to read English")}`;
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "other-language-allowed" });
  });

  it("a preamble line without a veto does not create evidence", () => {
    const text = `Patients must speak English.\n\n${inc("Age 18 or older")}`;
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "unclear" });
  });

  it("evidence still comes only from the sections", () => {
    const text = `Study visits are in English.\n\n${inc("Must speak English")}`;
    expect(detectEnglishRequirement(text)).toEqual({ status: "required", evidence: ["Must speak English"] });
  });
});

describe("scope checks stay linear (R1.4)", () => {
  it("a 300,000+ character line with thousands of English mentions inside a section", () => {
    const inclusionLine = "not english speak ".repeat(20_000);
    const exclusionLine = "no english speaking. ".repeat(20_000);
    const text = `${inc(inclusionLine)}\n\n${exc(exclusionLine)}`;
    expect(text.length).toBeGreaterThan(300_000);
    const started = Date.now();
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "unclear" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("properties", () => {
  // Lines that are requirements under Inclusion (no negation at all).
  const positive = fc.constantFrom(
    "English speaking",
    "English-speaking",
    "Must speak English",
    "Must be able to read, speak and understand English",
    "Comfortable conversing in English",
    "English proficiency sufficient for informed consent",
    "Fluent in English",
  );
  // A clause whose negation is about something other than English.
  const unrelatedNegation = fc.constantFrom(
    " with no prior treatment",
    " without prior surgery",
    " who have no history of stroke",
    "; no prior chemotherapy",
    ". Not pregnant",
    ", and no active infection",
  );
  const fillerWord = fc.constantFrom("adult", "patients", "aged", "18", "or", "older", "receiving", "care", "at", "site");

  it("an unrelated negation never turns a positive English line into an exclusion requirement", () => {
    fc.assert(
      fc.property(positive, unrelatedNegation, fc.array(fillerWord, { maxLength: 4 }), (line, tail, extra) => {
        const text = exc(`${line}${tail} ${extra.join(" ")}`.trim());
        expect(detectEnglishRequirement(text).status).not.toBe("required");
      }),
      { numRuns: 300 },
    );
  });

  const nonLanguageClause = fc.constantFrom(
    "Able to attend all visits",
    "Able to walk unassisted",
    "Ability to swallow tablets",
    "Able to provide a blood sample",
  );
  const documentClause = fc.constantFrom(
    "Study materials are written in English",
    "Questionnaires are in English",
    "Consent forms are available in English",
    "Visits are conducted in English",
  );
  const sep = fc.constantFrom(". ", "; ", "! ", " and ");

  it("a generic ability plus English documents is never a requirement", () => {
    fc.assert(
      fc.property(nonLanguageClause, sep, documentClause, (a, s, d) => {
        expect(detectEnglishRequirement(inc(`${a}${s}${d}`)).status).not.toBe("required");
      }),
      { numRuns: 300 },
    );
  });

  const vetoPreamble = fc.constantFrom(
    "Non-English speakers may participate with an interpreter.",
    "Materials are available in English and Spanish.",
    "Translation from English is provided.",
    "Speaking English is not required.",
  );

  it("a veto anywhere before the first heading keeps any criteria from being required", () => {
    fc.assert(
      fc.property(vetoPreamble, positive, fc.boolean(), (veto, line, asExclusion) => {
        const body = asExclusion ? exc(`Unable to speak English`) : inc(line);
        expect(detectEnglishRequirement(`${veto}\n\n${body}`).status).not.toBe("required");
      }),
      { numRuns: 300 },
    );
  });
});

// Second independent review (at eb555d5). The reviewer's exact cases are in
// english-requirement.review2.test.ts; these check the general rules with other wording.
describe("second review: only a deficiency word after English binds (R2.5)", () => {
  it.each([
    "English speakers not currently pregnant",
    "English readers not enrolled in another trial",
    "English proficiency not measured at baseline",
    "English-speaking adults no longer in treatment",
    "Fluent English speakers who are not smokers",
    "English speakers don't require sedation",
  ])("exclusion '%s' is not required", (line) => {
    expect(detectEnglishRequirement(exc(line)).status).not.toBe("required");
  });

  it.each(["English proficiency is poor", "English proficiency insufficient for consent", "English literacy is limited"])(
    "exclusion control '%s' is still required",
    (line) => {
      expect(detectEnglishRequirement(exc(line))).toEqual({ status: "required", evidence: [line] });
    },
  );
});

describe("second review: the ability word must be linked to English (R2.8)", () => {
  it.each([
    "Able to follow instructions: forms are in English",
    "Can comprehend instructions (provided in English)",
    "Able to write, surveys are available in English",
    "Reads at a 6th-grade level and was given an English handout",
    "Understands the procedures which are explained in English",
  ])("inclusion '%s' is not required", (line) => {
    expect(detectEnglishRequirement(inc(line))).toEqual({ status: "mentioned", reason: "unclear" });
  });

  it.each([
    "Must be able to read, speak and understand English",
    "Able to read and write English",
    "English speaking, reading and writing",
    "Speaks and understands English fluently",
  ])("inclusion control '%s' is still required", (line) => {
    expect(detectEnglishRequirement(inc(line))).toEqual({ status: "required", evidence: [line] });
  });

  it("known miss (fails closed): a comma list whose last verb is not a language word", () => {
    const line = "Able to read, understand, and sign the consent form in English";
    expect(detectEnglishRequirement(inc(line))).toEqual({ status: "mentioned", reason: "unclear" });
  });
});

describe("second review properties", () => {
  const englishSubject = fc.constantFrom(
    "English speakers",
    "English-speaking adults",
    "Fluent English speakers",
    "English literacy",
    "English proficiency",
    "English readers",
  );
  const otherPredicate = fc.constantFrom(
    "on dialysis",
    "previously treated",
    "assessed",
    "able to attend visits",
    "currently enrolled",
    "pregnant",
    "taking insulin",
  );
  const looseNegation = fc.constantFrom("not", "no longer", "never", "don't need to be", "who are not");

  it("R10.9 a negation after English that is not a deficiency word never makes an exclusion requirement", () => {
    fc.assert(
      fc.property(englishSubject, looseNegation, otherPredicate, (subject, neg, pred) => {
        expect(detectEnglishRequirement(exc(`${subject} ${neg} ${pred}`)).status).not.toBe("required");
      }),
      { numRuns: 300 },
    );
  });

  const abilityAboutSomethingElse = fc.constantFrom(
    "Able to understand study procedures",
    "Able to communicate symptoms",
    "Understands the study",
    "Can read",
    "Reads street signs",
    "Able to write a diary",
  );
  const joiner = fc.constantFrom(", ", " (vision adequate) and ", ": ", " which ", " that ", "; ");
  const englishThing = fc.constantFrom(
    "questionnaires are in English",
    "the app is in English",
    "materials provided in English",
    "has an English-language phone",
    "is delivered in English",
    "were written in English",
  );

  it("R10.10 an ability word separated from English by a link barrier is never a requirement", () => {
    fc.assert(
      fc.property(abilityAboutSomethingElse, joiner, englishThing, (ability, join, thing) => {
        expect(detectEnglishRequirement(inc(`${ability}${join}${thing}`)).status).not.toBe("required");
      }),
      { numRuns: 300 },
    );
  });
});
