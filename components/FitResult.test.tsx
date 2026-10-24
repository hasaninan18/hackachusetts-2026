import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getDictionary, translator } from "../lib/i18n";
import { getMockTrial } from "../lib/mock/data";
import { hasCriteriaContent, quickCheck, type FitResult as FitResultData } from "../lib/quickCheck";
import type { Eligibility } from "../lib/types";
import { FitResult, fitHeadingKeys } from "./FitResult";

const eligibility: Eligibility = {
  minAgeYears: 18,
  maxAgeYears: null,
  sex: "ALL",
  healthyVolunteers: true,
  criteriaText: "",
};

function render(result: FitResultData, lang: "en" | "es" = "en") {
  const t = translator(getDictionary(lang));
  return renderToStaticMarkup(
    <FitResult result={result} eligibility={eligibility} questions={[]} answers={{}} lang={lang} t={t} />,
  );
}

describe("FitResult with missing study info (fit-check Requirement 7)", () => {
  it("says 'not sure' instead of 'some answers may rule you out', without repeating the reason", () => {
    const html = render({ outcome: "ask-team", reasons: [{ kind: "insufficient-info" }] });
    expect(html).toContain("Not sure yet");
    expect(html).toContain("This study did not share enough about who can join. Ask the study team.");
    expect(html).not.toContain("Some answers may rule you out");
    expect(html).not.toContain("<li");
    expect(html).toContain("bg-ask-bg"); // still the amber caution panel, never red
  });

  it("with criteria but no questions (model failed), never shows the possible-fit wording", () => {
    const html = render({ outcome: "ask-team", reasons: [{ kind: "unchecked-criteria" }] });
    expect(html).toContain("Not sure yet");
    expect(html).toContain("We could not ask you about all of this study&#x27;s rules.");
    expect(html).not.toContain("may be a possible fit");
    expect(html).not.toContain("<li");
  });

  it("keeps 'some answers may rule you out' and lists every reason when there is another reason", () => {
    const html = render({
      outcome: "ask-team",
      reasons: [{ kind: "age-too-young" }, { kind: "insufficient-info" }],
    });
    expect(html).toContain("Some answers may rule you out");
    expect(html).toContain("The study is for people 18 or older.");
    expect(html).toContain("This study did not share enough about who can join.");
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it("uses the same heading keys the live region announces, in every language", () => {
    expect(fitHeadingKeys({ outcome: "possible-fit", reasons: [] }).title).toBe("fit.possibleTitle");
    expect(fitHeadingKeys({ outcome: "ask-team", reasons: [{ kind: "sex" }] }).title).toBe("fit.askTitle");
    expect(fitHeadingKeys({ outcome: "ask-team", reasons: [{ kind: "insufficient-info" }] })).toEqual({
      title: "fit.unsureTitle",
      body: "fit.reason.insufficient-info",
    });
    expect(fitHeadingKeys({ outcome: "ask-team", reasons: [{ kind: "unchecked-criteria" }] })).toEqual({
      title: "fit.unsureTitle",
      body: "fit.reason.unchecked-criteria",
    });
    expect(render({ outcome: "ask-team", reasons: [{ kind: "unchecked-criteria" }] }, "es")).toContain(
      "Aún no está claro",
    );
  });
});

// Hasan's PR #16 browser repro: the hero detail from the Dorchester point with /api/simplify
// failing (503, or 404 while it is not deployed), age 55, "Do you have the condition?" Yes.
// The page passes the registry's criteria text, but no checklist questions were made from it,
// so that text was never checked and must not read as a possible fit.
describe("hero NCT07043426 with criteria text but no generated questions", () => {
  const hero = getMockTrial("NCT07043426")!;
  // React escapes these in text, e.g. "study's" becomes "study&#x27;s".
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  const renderHero = (result: FitResultData, lang: "en" | "es") =>
    renderToStaticMarkup(
      <FitResult
        result={result}
        eligibility={hero.eligibility}
        questions={[]}
        answers={{}}
        lang={lang}
        t={translator(getDictionary(lang))}
      />,
    );

  it("age 55 with the condition says 'Not sure yet', never 'may be a possible fit'", () => {
    expect(hasCriteriaContent(hero.eligibility.criteriaText)).toBe(true);
    const result = quickCheck({ age: 55, healthy: false }, hero.eligibility, [], {});
    expect(result).toEqual({ outcome: "ask-team", reasons: [{ kind: "unchecked-criteria" }] });
    for (const lang of ["en", "es"] as const) {
      const dict = getDictionary(lang);
      const html = renderHero(result, lang);
      expect(html).toContain(escape(dict["fit.unsureTitle"]));
      expect(html).toContain(escape(dict["fit.reason.unchecked-criteria"]));
      expect(html).not.toContain(escape(dict["fit.possibleTitle"]));
      expect(html).not.toContain(escape(dict["fit.possibleBody"]));
    }
  });

  it("still lists a real structured mismatch with it (age 15 is under the study's 18)", () => {
    const result = quickCheck({ age: 15, healthy: false }, hero.eligibility, [], {});
    expect(result.reasons).toEqual([{ kind: "age-too-young" }, { kind: "unchecked-criteria" }]);
    const html = renderHero(result, "en");
    expect(html).toContain("Some answers may rule you out");
    expect(html).toContain("The study is for people 18 or older.");
    expect(html.match(/<li/g)).toHaveLength(2);
  });
});
