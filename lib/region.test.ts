// Unit + property tests for the region module (docs/NATIONAL_PLAN.md §2) and the
// region-aware site filter in lib/clinicaltrials.ts. NO network: raw CtgStudy fixtures only.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CtgLocation, CtgStudy } from "./api-types";
import { buildContacts, recruitingSites, slimStudy, toDetail } from "./clinicaltrials";
import {
  ACTIVE_REGION,
  REGIONS,
  US_STATES,
  locationInRegion,
  regionHasStateCode,
  resolveRegion,
} from "./region";

function site(overrides: Partial<CtgLocation>): CtgLocation {
  return {
    facility: "Test Hospital",
    city: "Somewhere",
    status: "RECRUITING",
    geoPoint: { lat: 40, lon: -75 },
    ...overrides,
  };
}

const boston = site({
  facility: "Boston Medical Center",
  city: "Boston",
  state: "Massachusetts",
  country: "United States",
  geoPoint: { lat: 42.335, lon: -71.0728 },
});
const providence = site({
  facility: "Rhode Island Hospital",
  city: "Providence",
  state: "Rhode Island",
  country: "United States",
  geoPoint: { lat: 41.811, lon: -71.408 },
});
const houston = site({
  facility: "MD Anderson Cancer Center",
  city: "Houston",
  state: "Texas",
  country: "United States",
  geoPoint: { lat: 29.707, lon: -95.397 },
});
const toronto = site({
  facility: "Toronto General Hospital",
  city: "Toronto",
  state: "Ontario",
  country: "Canada",
  geoPoint: { lat: 43.659, lon: -79.388 },
});

function study(locations: CtgLocation[]): CtgStudy {
  return {
    protocolSection: {
      identificationModule: { nctId: "NCT00000001", briefTitle: "Region test study" },
      contactsLocationsModule: { locations },
    },
  };
}

describe("resolveRegion", () => {
  it("returns each known region", () => {
    expect(resolveRegion("ma")).toBe(REGIONS.ma);
    expect(resolveRegion("new-england")).toBe(REGIONS["new-england"]);
    expect(resolveRegion("us")).toBe(REGIONS.us);
  });

  it("falls back to ma for anything unknown, so the live MA site never changes by accident", () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: undefined }).filter((s) => !(s && s in REGIONS)),
        (raw) => {
          expect(resolveRegion(raw)).toBe(REGIONS.ma);
        },
      ),
    );
    // Prototype keys must not resolve to anything.
    expect(resolveRegion("toString")).toBe(REGIONS.ma);
    expect(resolveRegion("__proto__")).toBe(REGIONS.ma);
  });

  it("defaults the active region to ma when the env var is unset in tests", () => {
    expect(ACTIVE_REGION).toBe(REGIONS.ma);
  });
});

describe("REGIONS", () => {
  it("covers all 50 states plus DC for us", () => {
    expect(REGIONS.us.states).toHaveLength(51);
    expect(new Set(REGIONS.us.states).size).toBe(51);
  });

  it("only lists real state codes", () => {
    for (const region of Object.values(REGIONS)) {
      for (const code of region.states) expect(US_STATES[code]).toBeTypeOf("string");
    }
  });

  it("nests ma inside new-england inside us", () => {
    for (const code of REGIONS.ma.states) expect(regionHasStateCode(REGIONS["new-england"], code)).toBe(true);
    for (const code of REGIONS["new-england"].states) expect(regionHasStateCode(REGIONS.us, code)).toBe(true);
  });
});

describe("locationInRegion", () => {
  it("matches by full state name", () => {
    expect(locationInRegion(REGIONS.ma, boston)).toBe(true);
    expect(locationInRegion(REGIONS.ma, providence)).toBe(false);
    expect(locationInRegion(REGIONS["new-england"], providence)).toBe(true);
    expect(locationInRegion(REGIONS["new-england"], houston)).toBe(false);
    expect(locationInRegion(REGIONS.us, houston)).toBe(true);
  });

  it("rejects non-US sites even in the us region", () => {
    expect(locationInRegion(REGIONS.us, toronto)).toBe(false);
    // A foreign site that happens to use a US state name is still outside the US.
    expect(locationInRegion(REGIONS.us, { state: "Georgia", country: "Georgia" })).toBe(false);
  });

  it("judges a site without a country by state alone (older fixtures)", () => {
    expect(locationInRegion(REGIONS.ma, { state: "Massachusetts" })).toBe(true);
  });

  it("rejects sites with no state", () => {
    expect(locationInRegion(REGIONS.us, { country: "United States" })).toBe(false);
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(REGIONS)),
        fc.record({ state: fc.option(fc.string(), { nil: undefined }), country: fc.option(fc.string(), { nil: undefined }) }),
        (region, loc) => {
          expect(typeof locationInRegion(region, loc)).toBe("boolean");
        },
      ),
    );
  });
});

describe("recruitingSites by region", () => {
  const all = [boston, providence, houston, toronto, site({ ...houston, status: "COMPLETED" })];

  it("keeps only the active region (ma) by default", () => {
    expect(recruitingSites(all).map((s) => s.city)).toEqual(["Boston"]);
  });

  it("widens to New England and the whole US", () => {
    expect(recruitingSites(all, REGIONS["new-england"]).map((s) => s.city)).toEqual(["Boston", "Providence"]);
    expect(recruitingSites(all, REGIONS.us).map((s) => s.city)).toEqual(["Boston", "Providence", "Houston"]);
  });
});

describe("slimStudy / toDetail by region", () => {
  it("drops a Texas-only study in ma but keeps it in us", () => {
    const texasOnly = study([houston]);
    expect(slimStudy(texasOnly)).toBeNull();
    const slim = slimStudy(texasOnly, { lat: 29.76, lon: -95.37 }, REGIONS.us);
    expect(slim?.nearestSite.city).toBe("Houston");
    expect(slim?.distanceMi).toBeLessThan(5);
  });

  it("picks the nearest in-region site nationally", () => {
    const multi = study([boston, houston]);
    const nearHouston = slimStudy(multi, { lat: 29.76, lon: -95.37 }, REGIONS.us);
    expect(nearHouston?.nearestSite.city).toBe("Houston");
    // In ma, the Houston site is invisible, so Boston is nearest even from Texas.
    expect(slimStudy(multi, { lat: 29.76, lon: -95.37 })?.nearestSite.city).toBe("Boston");
  });

  it("lists only in-region sites in the detail view", () => {
    const detail = toDetail(study([boston, providence, toronto]), undefined, REGIONS["new-england"]);
    expect(detail.sites.map((s) => s.city)).toEqual(["Boston", "Providence"]);
  });

  it("falls back to in-region site contacts only", () => {
    const withContacts = [
      { ...houston, contacts: [{ name: "Houston team", phone: "713-555-0100" }] },
      { ...toronto, contacts: [{ name: "Toronto team", phone: "416-555-0100" }] },
    ];
    expect(buildContacts(undefined, withContacts, REGIONS.us)).toEqual([
      { name: "Houston team", phone: "713-555-0100" },
    ]);
    expect(buildContacts(undefined, withContacts)).toEqual([]);
  });
});
