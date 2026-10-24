import { describe, expect, it } from "vitest";
import { getMockSimplified } from "./mock/simplified";
import { parseSimplified } from "./simplify";

const FALLBACK = "Ask the study team.";

describe("parseSimplified", () => {
  it("accepts the lib/types.ts shape unchanged", () => {
    const mock = getMockSimplified("NCT05799222", "es")!;
    expect(parseSimplified(mock, "es", FALLBACK)).toEqual(mock);
  });

  it("accepts the docs/TASKS.md shape (summary, rulesOut, no lang/timeCommitment)", () => {
    const r = parseSimplified(
      {
        summary: "Este estudio prueba batidos.",
        whatYouDo: "Usaría reemplazos de comida.",
        questions: [{ id: 1, text: "¿Tiene diabetes?", rulesOut: "no" }],
      },
      "es",
      FALLBACK,
    );
    expect(r).toEqual({
      lang: "es",
      whatItStudies: "Este estudio prueba batidos.",
      whatYouDo: "Usaría reemplazos de comida.",
      timeCommitment: FALLBACK,
      questions: [{ id: "1", text: "¿Tiene diabetes?", ruleOutIf: "no" }],
    });
  });

  it.each([
    ["null", null],
    ["missing summary", { whatYouDo: "x", questions: [] }],
    ["question without a rule", { summary: "x", whatYouDo: "y", questions: [{ id: "q1", text: "t" }] }],
    ["rule that isn't yes/no", { summary: "x", whatYouDo: "y", questions: [{ id: "q1", text: "t", rulesOut: "maybe" }] }],
    [
      "duplicate ids",
      {
        summary: "x",
        whatYouDo: "y",
        questions: [
          { id: "q1", text: "a", rulesOut: "yes" },
          { id: "q1", text: "b", rulesOut: "no" },
        ],
      },
    ],
  ])("rejects %s", (_name, value) => {
    expect(parseSimplified(value, "en", FALLBACK)).toBeNull();
  });
});
