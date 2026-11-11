// Second independent review of PR #35 (at eb555d5): the eight cases the reviewer reported as
// returning "required", plus the real requirements the reviewer said must still flag.
// The general rules behind the fix are tested in english-requirement.scope.test.ts.
import { describe, expect, it } from "vitest";
import { detectEnglishRequirement } from "./english-requirement";

const inc = (line: string) => `Inclusion Criteria:\n\n* ${line}`;
const exc = (line: string) => `Exclusion Criteria:\n\n* ${line}`;

describe("second review: a negation after English must be about the English ability", () => {
  it.each([
    "English speakers not on dialysis",
    "English speakers not previously treated",
    "English literacy not assessed",
    "Fluent English speakers not able to attend visits",
  ])("exclusion '%s' must fail closed", (line) => {
    expect(detectEnglishRequirement(exc(line)).status).not.toBe("required");
  });
});

describe("second review: the ability word must belong to English", () => {
  it.each([
    "Able to understand study procedures, questionnaires are in English",
    "Able to communicate symptoms, the app is in English",
    "Understands the study, materials provided in English",
    "Can read (vision adequate) and has an English-language phone",
  ])("inclusion '%s' must fail closed", (line) => {
    expect(detectEnglishRequirement(inc(line)).status).not.toBe("required");
  });
});

describe("second review: real requirements still flag", () => {
  it.each([
    ["inclusion", "Must speak English"],
    ["inclusion", "Fluent in English"],
    ["exclusion", "Unable to speak English"],
  ])("%s '%s' is required", (section, line) => {
    const text = section === "inclusion" ? inc(line) : exc(line);
    expect(detectEnglishRequirement(text)).toEqual({ status: "required", evidence: [line] });
  });
});
