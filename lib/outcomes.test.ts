import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fc from "fast-check";
import { parseOutcomes } from "./outcomes";
import { StudyResults } from "../components/StudyResults";
import { getDictionary, translator } from "./i18n";
import type { StudyOutcomes } from "./outcomes";

// Synthetic data for tests only. Never attach these numbers to a real trial fixture.
const nctId = "NCT00000000";
const report = {
  status: "available" as const, nctId, postedOn: "2026-10-01",
  summary: "Test report summary.", limitations: "Test report limitation.",
  measures: [{
    title: "Test measure", timeFrame: "12 weeks", statistic: "Mean change",
    groups: [
      { name: "Group A", participants: 24, value: "-2.5", unit: "points", uncertainty: "95% CI: -3.2 to -1.8" },
      { name: "Group B", participants: 23, value: "0", unit: "points" },
    ],
  }],
};

describe("study outcomes", () => {
  it("separates an absent integration, a source-confirmed absence and a failure", () => {
    expect(parseOutcomes(undefined, nctId)).toEqual({ status: "not_checked" });
    expect(parseOutcomes({ status: "not_posted", nctId, checkedOn: "2026-10-24" }, nctId).status).toBe("not_posted");
    expect(parseOutcomes({ status: "unavailable" }, nctId).status).toBe("unavailable");
    expect(parseOutcomes({ status: "not_posted", nctId }, nctId).status).toBe("unavailable");
  });

  it("preserves measure-specific counts, group values, units, time and uncertainty", () => {
    expect(parseOutcomes(report, nctId)).toEqual(report);
  });

  it("rejects results for another study and impossible posting dates", () => {
    expect(parseOutcomes(report, "NCT11111111").status).toBe("unavailable");
    expect(parseOutcomes({ ...report, postedOn: "2026-02-30" }, nctId).status).toBe("unavailable");
  });

  it.each([undefined, -1, 2.5, NaN, Infinity, "24"])("rejects an invalid denominator %s without dropping the group", (participants) => {
    const measure = report.measures[0];
    const bad = { ...report, measures: [{ ...measure, groups: [measure.groups[0], { ...measure.groups[1], participants }] }] };
    expect(parseOutcomes(bad, nctId).status).toBe("unavailable");
  });

  it("rejects a report missing its comparison context", () => {
    for (const key of ["title", "timeFrame", "statistic"] as const) {
      expect(parseOutcomes({ ...report, measures: [{ ...report.measures[0], [key]: "" }] }, nctId).status).toBe("unavailable");
    }
    expect(parseOutcomes({ ...report, measures: [] }, nctId).status).toBe("unavailable");
  });

  it("never throws for arbitrary JSON from an upstream endpoint", () => {
    fc.assert(fc.property(fc.jsonValue(), (value) => {
      expect(() => parseOutcomes(value, nctId)).not.toThrow();
    }));
  });
});

describe("study results section", () => {
  const render = (outcomes?: StudyOutcomes) => renderToStaticMarkup(createElement(StudyResults, {
    nctId, outcomes, t: translator(getDictionary("en")),
  }));

  it("renders sourced values and the limitations without inventing a personal success rate", () => {
    const html = render(report);
    for (const expected of ["24 people", "23 people", "-2.5", "points", "12 weeks", "95% CI", "Group B", "Test report limitation.", `${nctId}?tab=results`]) {
      expect(html).toContain(expected);
    }
    expect(html).toContain("They do not tell you what will happen to you");
    expect(html).toContain("print-only");
  });

  it("shows distinct honest empty and error messages", () => {
    expect(render()).toContain("Results have not been checked here yet");
    expect(render({ status: "not_posted", nctId, checkedOn: "2026-10-24" })).toContain("Results have not been posted");
    expect(render({ status: "unavailable" })).toContain("We cannot show the results right now");
  });

  it("escapes source text and fixes the link to the official registry", () => {
    const html = render({ ...report, summary: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(`https://clinicaltrials.gov/study/${nctId}?tab=results`);
  });
});
