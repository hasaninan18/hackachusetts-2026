import { describe, expect, it } from "vitest";
import { getMockTrial } from "./data";
import { matchesCondition, searchMockTrials } from "./search";

// docs/DEMO_DATA.md: Maria's Dorchester point (the documented hero search), and the ZIP 02124
// centroid that SearchForm uses for a typed ZIP (lib/ma-zips.json).
const MARIA = { lat: 42.3016, lon: -71.0676 };
const ZIP_02124 = { lat: 42.2859, lon: -71.075 };
const HERO = "NCT07043426";

const search = (cond: string, at: { lat: number; lon: number }, radius: number) =>
  searchMockTrials({ cond, ...at, radius });
const ids = (r: { trials: { nctId: string }[] }) => r.trials.map((t) => t.nctId);

describe("mock search (?mock=1)", () => {
  it("finds the hero for the documented search, nearest first", () => {
    // /en/results?cond=type%202%20diabetes&lat=42.3016&lon=-71.0676&radius=10&mock=1
    const r = search("type 2 diabetes", MARIA, 10);
    expect(ids(r)).toEqual([HERO, "NCT06138821", "NCT05799222"]);
    expect(r.total).toBe(3);
    const miles = r.trials.map((t) => t.distanceMi);
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
    expect(miles[0]).toBeCloseTo(2.32, 1); // BMC from Maria's point
    expect(Math.max(...miles)).toBeLessThanOrEqual(10);
  });

  it("keeps the registry's wording: only the matching is normalized, not the data", () => {
    const fixture = getMockTrial(HERO)!;
    expect(fixture.conditions).toEqual(["Diabetes Mellitus, Type 2"]);
    const hero = search("type 2 diabetes", MARIA, 10).trials[0];
    expect(hero.conditions).toEqual(fixture.conditions);
    expect(hero.title).toBe(fixture.title);
    expect(hero.nearestSite).toEqual(fixture.nearestSite);
  });

  it("applies the radius from the 02124 centroid: 5 mi leaves out MGH at 5.3 mi", () => {
    expect(ids(search("type 2 diabetes", ZIP_02124, 5))).toEqual([HERO, "NCT06138821"]);
    expect(ids(search("type 2 diabetes", ZIP_02124, 10))).toEqual([HERO, "NCT06138821", "NCT05799222"]);
    expect(ids(search("type 2 diabetes", ZIP_02124, 25))).toEqual([HERO, "NCT06138821", "NCT05799222"]);
    for (const radius of [5, 10, 25]) {
      for (const t of search("type 2 diabetes", ZIP_02124, radius).trials) {
        expect(t.distanceMi).toBeLessThanOrEqual(radius);
      }
    }
  });

  it("matches the words in any order, ignoring case and punctuation", () => {
    for (const cond of [
      "Type 2 Diabetes",
      "diabetes type 2",
      "type-2 diabetes",
      "TYPE 2 DIABETES MELLITUS",
      "Diabetes Mellitus, Type 2",
    ]) {
      expect(ids(search(cond, MARIA, 10))).toContain(HERO);
    }
  });

  it("still matches what it matched before (the search as typed, even part of a word)", () => {
    expect(ids(search("diabetes", MARIA, 10))).toEqual([HERO, "NCT06138821", "NCT05799222"]);
    expect(ids(search("diab", MARIA, 10))).toEqual([HERO, "NCT06138821", "NCT05799222"]);
    expect(ids(search("obes", MARIA, 10))).toEqual(["NCT06138821", "NCT05799222"]);
    expect(ids(search("social needs", MARIA, 10))).toEqual([HERO]); // from the title
  });

  it("does not stretch a search to other conditions", () => {
    expect(search("type 1 diabetes", MARIA, 25).trials).toEqual([]);
    expect(search("asthma", MARIA, 25)).toEqual({ trials: [], total: 0 });
  });

  it("needs every word in one title or condition, not spread over several", () => {
    const study = { title: "A study", conditions: ["Diabetes Type 1", "Obesity Class 2"] };
    expect(matchesCondition(study, "type 2 diabetes")).toBe(false);
    expect(matchesCondition({ ...study, conditions: ["Diabetes Mellitus, Type 2"] }, "type 2 diabetes")).toBe(
      true,
    );
  });
});
