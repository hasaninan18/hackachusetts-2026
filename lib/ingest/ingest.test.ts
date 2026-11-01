// Tests for the pure ingest modules (lib/ingest/ctgov.ts, lib/ingest/quality.ts). NO network.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CtgLocation } from "../api-types";
import { REGIONS } from "../region";
import { type IngestStudy, MAX_PAGE_SIZE, buildUsPageUrl, toRows } from "./ctgov";
import { classifyEnglish, markSharedPointsAsCity, qualityReport, sharedPoints } from "./quality";

function loc(overrides: Partial<CtgLocation>): CtgLocation {
  return {
    facility: "General Hospital",
    city: "Houston",
    state: "Texas",
    zip: "77030",
    country: "United States",
    status: "RECRUITING",
    geoPoint: { lat: 29.707, lon: -95.397 },
    ...overrides,
  };
}

function study(locations: CtgLocation[], extra: Partial<NonNullable<IngestStudy["protocolSection"]>> = {}): IngestStudy {
  return {
    protocolSection: {
      identificationModule: { nctId: "NCT01234567", briefTitle: "A study" },
      conditionsModule: { conditions: ["Asthma"] },
      designModule: { phases: ["PHASE3"] },
      eligibilityModule: { eligibilityCriteria: "Adults 18+", minimumAge: "18 Years", sex: "ALL" },
      contactsLocationsModule: { locations },
      ...extra,
    },
  };
}

describe("buildUsPageUrl", () => {
  it("asks for recruiting US studies with a total on the first page", () => {
    const url = new URL(buildUsPageUrl());
    expect(url.searchParams.get("query.locn")).toBe('AREA[LocationCountry]"United States"');
    expect(url.searchParams.get("filter.overallStatus")).toBe("RECRUITING");
    expect(url.searchParams.get("pageSize")).toBe(String(MAX_PAGE_SIZE));
    expect(url.searchParams.get("countTotal")).toBe("true");
    expect(url.searchParams.get("fields")).toContain("LocationCountry");
    expect(url.searchParams.has("pageToken")).toBe(false);
  });

  it("passes the page token on later pages", () => {
    const url = new URL(buildUsPageUrl({ pageToken: "abc" }));
    expect(url.searchParams.get("pageToken")).toBe("abc");
    expect(url.searchParams.has("countTotal")).toBe(false);
  });

  it("limits to recently updated studies with since", () => {
    const url = new URL(buildUsPageUrl({ since: "2026-10-31" }));
    expect(url.searchParams.get("filter.advanced")).toBe("AREA[LastUpdatePostDate]RANGE[2026-10-31,MAX]");
    expect(() => buildUsPageUrl({ since: "yesterday" })).toThrow();
  });

  it("clamps page size to 1..1000", () => {
    fc.assert(
      fc.property(fc.integer({ min: -5000, max: 5000 }), (n) => {
        const size = Number(new URL(buildUsPageUrl({ pageSize: n })).searchParams.get("pageSize"));
        expect(size).toBeGreaterThanOrEqual(1);
        expect(size).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      }),
    );
  });
});

describe("toRows", () => {
  it("keeps recruiting US sites with their state code and ordinal", () => {
    const rows = toRows(
      study([
        loc({}),
        loc({ facility: "Toronto General", city: "Toronto", state: "Ontario", country: "Canada" }),
        loc({ facility: "Closed Clinic", status: "COMPLETED" }),
        loc({ facility: "Rhode Island Hospital", city: "Providence", state: "Rhode Island", geoPoint: { lat: 41.81, lon: -71.41 } }),
      ]),
    );
    expect(rows?.sites.map((s) => [s.name, s.state, s.ordinal])).toEqual([
      ["General Hospital", "TX", 0],
      ["Rhode Island Hospital", "RI", 1],
    ]);
    expect(rows?.trial).toMatchObject({ nctId: "NCT01234567", phase: "Phase 3", conditions: ["Asthma"] });
  });

  it("returns null for a study with no qualifying site or a bad NCT ID", () => {
    expect(toRows(study([loc({ country: "Canada", state: "Ontario" })]))).toBeNull();
    const bad = study([loc({})]);
    bad.protocolSection!.identificationModule!.nctId = "junk";
    expect(toRows(bad)).toBeNull();
  });

  it("respects a narrower region", () => {
    expect(toRows(study([loc({})]), REGIONS.ma)).toBeNull();
  });

  it("places a site with no geoPoint at its ZIP centroid, never at Boston", () => {
    const rows = toRows(study([loc({ geoPoint: undefined, zip: "77030-1234" })]), REGIONS.us, (zip) =>
      zip === "77030" ? { lat: 29.7, lon: -95.4 } : null,
    );
    expect(rows?.sites[0]).toMatchObject({ lat: 29.7, lon: -95.4, locationPrecision: "zip" });
    expect(rows?.droppedNoLocation).toBe(0);
  });

  it("drops a site it cannot place and counts it", () => {
    const rows = toRows(study([loc({}), loc({ facility: "Nowhere", geoPoint: undefined, zip: undefined })]));
    expect(rows?.sites).toHaveLength(1);
    expect(rows?.droppedNoLocation).toBe(1);
  });

  it("reads sponsor and last update", () => {
    const rows = toRows(
      study([loc({})], {
        sponsorCollaboratorsModule: { leadSponsor: { name: "Acme Pharma" } },
        statusModule: { lastUpdatePostDateStruct: { date: "2026-10-30" } },
      }),
    );
    expect(rows?.trial).toMatchObject({ sponsor: "Acme Pharma", lastUpdate: "2026-10-30" });
  });
});

describe("sharedPoints", () => {
  const rows = toRows(
    study([
      loc({ facility: "Clinic A", city: "Dallas", geoPoint: { lat: 32.78306, lon: -96.80667 } }),
      loc({ facility: "Clinic B", city: "Dallas", geoPoint: { lat: 32.78306, lon: -96.80667 } }),
      loc({ facility: "Clinic C", city: "Dallas", geoPoint: { lat: 32.78306, lon: -96.80667 } }),
      loc({ facility: "Clinic C.", city: "Dallas", geoPoint: { lat: 32.78306, lon: -96.80667 } }),
      loc({ facility: "Real Building", geoPoint: { lat: 29.71, lon: -95.4 } }),
      loc({ facility: "Real Building 2", geoPoint: { lat: 29.71, lon: -95.4 } }),
    ]),
  )!;

  it("flags a point shared by 3+ distinct facilities and counts every site on it", () => {
    expect(sharedPoints(rows.sites)).toEqual([
      { lat: 32.7831, lon: -96.8067, city: "Dallas", state: "TX", facilities: 3, sites: 4 },
    ]);
  });

  it("relabels sites on a shared point as city precision without touching others", () => {
    const [marked] = markSharedPointsAsCity([rows]);
    expect(marked.sites.map((s) => s.locationPrecision)).toEqual([
      "city", "city", "city", "city", "facility", "facility",
    ]);
    expect(rows.sites[0].locationPrecision).toBe("facility");
  });

  it("ignores ZIP-centroid placements", () => {
    expect(sharedPoints(rows.sites.map((s) => ({ ...s, locationPrecision: "zip" as const })))).toEqual([]);
  });
});

describe("classifyEnglish", () => {
  it.each([
    ["Adults with asthma", "none"],
    ["Questionnaires are available in English", "mentions"],
    ["Able to read and understand English", "required"],
    ["English-speaking participants only", "required"],
    ["Exclusion: Non-English speakers", "required"],
    ["Must be fluent in English or Spanish", "required-or-other"],
    ["Able to speak Spanish or English", "required-or-other"],
  ])("%s → %s", (text, expected) => {
    expect(classifyEnglish(text)).toBe(expected);
  });
});

describe("qualityReport", () => {
  it("counts trials, sites, states, precision and English classes", () => {
    const a = toRows(study([loc({}), loc({ facility: "B", state: "Ohio", city: "Columbus" })]))!;
    const b = toRows(
      study([loc({})], {
        identificationModule: { nctId: "NCT07654321" },
        eligibilityModule: { eligibilityCriteria: "Must speak English" },
      }),
    )!;
    const report = qualityReport([a, b], 2);
    expect(report).toMatchObject({
      trials: 2,
      sites: 3,
      sitesByState: { TX: 2, OH: 1 },
      sitesByPrecision: { facility: 3 },
      sitesDroppedNoLocation: 2,
      english: { none: 1, mentions: 0, required: 1, "required-or-other": 0 },
    });
  });
});
