import { describe, expect, it } from "vitest";
import { detectEnglishRequirement } from "./english-requirement";

describe("independent review false-positive regressions", () => {
  it.each([
    ["inclusion states inability", "Inclusion Criteria:\n* Illiterate in English"],
    ["negation belongs to treatment history", "Exclusion Criteria:\n* English-speaking patients with no prior treatment"],
    ["ability belongs to visits and English to documents", "Inclusion Criteria:\n* Able to attend all visits. Study materials are written in English."],
    ["study-wide veto precedes first heading", "Non-English speakers may participate with an interpreter.\n\nInclusion Criteria:\n* Must speak English"],
  ])("%s must fail closed", (_label, criteria) => {
    expect(detectEnglishRequirement(criteria).status).not.toBe("required");
  });
});
