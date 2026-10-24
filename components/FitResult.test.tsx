import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getDictionary, translator } from "../lib/i18n";
import type { FitResult as FitResultData } from "../lib/quickCheck";
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
    expect(html).toContain("Not sure from the study&#x27;s details");
    expect(html).toContain("This study did not share enough about who can join. Ask the study team.");
    expect(html).not.toContain("Some answers may rule you out");
    expect(html).not.toContain("<li");
    expect(html).toContain("bg-ask-bg"); // still the amber caution panel, never red
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
    expect(fitHeadingKeys({ outcome: "ask-team", reasons: [{ kind: "insufficient-info" }] }).title).toBe(
      "fit.unsureTitle",
    );
    expect(render({ outcome: "ask-team", reasons: [{ kind: "insufficient-info" }] }, "es")).toContain(
      "No está claro con la información del estudio",
    );
  });
});
