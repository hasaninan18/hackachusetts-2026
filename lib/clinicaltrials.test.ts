// Unit + property tests for the pure parse/slim/rank module (spec: trial-search-api, Task 5).
//
// Everything here runs against in-repo fixtures — NO network. Fixtures are raw
// ClinicalTrials.gov v2 `CtgStudy` shapes (lib/api-types.ts) for the five DEMO_DATA demo
// NCT IDs, each reporting from the shared Boston centroid so slimStudy/toDetail must route
// through the facility-coordinate correction in lib/facilities.ts. Style mirrors
// lib/facilities.test.ts: fast-check for properties, Vitest for examples.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  CtgContact,
  CtgEligibilityModule,
  CtgLocation,
  CtgStudy,
} from "./api-types";
import {
  buildContacts,
  nearestSite,
  parseAge,
  parsePhase,
  rankBySiteDistance,
  slimStudy,
  toDetail,
} from "./clinicaltrials";
import { BOSTON_CENTROID } from "./facilities";
import { haversineMi } from "./geo";
import type { Site } from "./types";

// ---------------------------------------------------------------------------
// Fixtures: raw CtgStudy for the five demo NCT IDs.
// Every site reports from the shared Boston centroid (BOSTON_CENTROID) with its real
// facility name, RECRUITING status, and state "Massachusetts" — exactly what the upstream
// returns before correction. Correction is lib/facilities.ts's job and is asserted below.
// ---------------------------------------------------------------------------

const CENTROID = { lat: BOSTON_CENTROID.lat, lon: BOSTON_CENTROID.lon };

/** DEMO_DATA "Use" coordinates each centroid facility name must correct to. */
const CORRECTED = {
  BMC: { lat: 42.335, lon: -71.0728 },
  MGH: { lat: 42.3625, lon: -71.0694 },
  BWH: { lat: 42.3355, lon: -71.1067 },
  BIDMC: { lat: 42.3396, lon: -71.1066 },
} as const;

interface FixtureOpts {
  nctId: string;
  facility: string;
  condition: string;
  phases?: string[];
  eligibility?: CtgEligibilityModule;
  /** Study-level central contacts (LocationContactName/Phone/EMail live on locations). */
  centralContacts?: CtgContact[];
  /** Raw locations; defaults to a single RECRUITING MA site at the Boston centroid. */
  locations?: CtgLocation[];
}

/**
 * Construct a raw {@link CtgStudy} fixture. Defaults give one RECRUITING, Massachusetts
 * location at the Boston centroid named `facility`, so callers only override what a given
 * test exercises. Keeps the fixtures below short and readable.
 */
function makeStudy(opts: FixtureOpts): CtgStudy {
  const {
    nctId,
    facility,
    condition,
    phases = ["PHASE2"],
    eligibility,
    centralContacts,
    locations,
  } = opts;
  const defaultLocation: CtgLocation = {
    facility,
    city: "Boston",
    state: "Massachusetts",
    zip: "02118",
    status: "RECRUITING",
    geoPoint: { lat: CENTROID.lat, lon: CENTROID.lon },
  };
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: `${facility} — ${condition} study` },
      conditionsModule: { conditions: [condition] },
      designModule: { phases },
      descriptionModule: { briefSummary: `A ${condition} trial at ${facility}.` },
      eligibilityModule: eligibility,
      contactsLocationsModule: {
        locations: locations ?? [defaultLocation],
        centralContacts,
      },
    },
  };
}

// HERO fixture: BMC, exercises CENTRAL contacts (phone + email present).
const bmcStudy = makeStudy({
  nctId: "NCT07043426",
  facility: "Boston Medical Center",
  condition: "Type 2 Diabetes",
  phases: ["PHASE2"],
  eligibility: { minimumAge: "18 Years", maximumAge: "N/A", sex: "ALL", healthyVolunteers: false },
  centralContacts: [
    { name: "THRIVE-DM Study Team", phone: "617-555-0101", email: "thrive@bmc.org", role: "CONTACT" },
    // PI with no phone/email must be dropped by buildContacts.
    { name: "Dr. Jane Doe", role: "PRINCIPAL_INVESTIGATOR" },
  ],
});

// MGH lung-screening fixture: exercises the SITE/location-contacts fallback (no central).
const mghLungStudy = makeStudy({
  nctId: "NCT05784922",
  facility: "Massachusetts General Hospital",
  condition: "Lung Cancer Screening",
  phases: ["PHASE3"],
  eligibility: { minimumAge: "50 Years", maximumAge: "80 Years", sex: "ALL", healthyVolunteers: false },
  // No central contacts → buildContacts falls back to the location's own contacts.
  locations: [
    {
      facility: "Massachusetts General Hospital",
      city: "Boston",
      state: "Massachusetts",
      zip: "02114",
      status: "RECRUITING",
      geoPoint: { lat: CENTROID.lat, lon: CENTROID.lon },
      contacts: [
        { name: "MGH Lung Team", phone: "617-555-0202", email: "lung@mgh.org", role: "CONTACT" },
      ],
    },
  ],
});

// Brigham FaceAge fixture: healthy volunteers, central contact.
const bwhStudy = makeStudy({
  nctId: "NCT07719049",
  facility: "Brigham and Women's Hospital",
  condition: "Healthy Aging",
  phases: ["NA"],
  eligibility: { minimumAge: "18 Years", maximumAge: "N/A", sex: "ALL", healthyVolunteers: true },
  centralContacts: [
    { name: "FaceAge Coordinator", phone: "617-555-0303", role: "CONTACT" },
  ],
});

// BIDMC wearable-BP fixture: central contact with email only.
const bidmcStudy = makeStudy({
  nctId: "NCT06610448",
  facility: "Beth Israel Deaconess Medical Center",
  condition: "Blood Pressure Monitoring",
  phases: ["PHASE1", "PHASE2"],
  eligibility: { minimumAge: "21 Years", maximumAge: "75 Years", sex: "ALL", healthyVolunteers: true },
  centralContacts: [{ name: "BIDMC BP Study", email: "bp@bidmc.org", role: "CONTACT" }],
});

// MGH CHAMPION fixture: second MGH trial, central contact.
const mghChampionStudy = makeStudy({
  nctId: "NCT06432790",
  facility: "Massachusetts General Hospital",
  condition: "Pediatric Care",
  phases: ["PHASE2"],
  eligibility: { minimumAge: "6 Months", maximumAge: "17 Years", sex: "ALL", healthyVolunteers: false },
  centralContacts: [{ name: "CHAMPION Team", phone: "617-555-0404", role: "CONTACT" }],
});

/** The five demo fixtures in demo-lineup order. */
const ALL_FIXTURES: CtgStudy[] = [
  bmcStudy,
  mghLungStudy,
  bwhStudy,
  bidmcStudy,
  mghChampionStudy,
];

/** Dorchester reference origin (docs/DEMO_DATA.md — Maria's point). */
const DORCHESTER = { lat: 42.3016, lon: -71.0676 };

// ---------------------------------------------------------------------------
// parseAge
// ---------------------------------------------------------------------------

describe("parseAge", () => {
  it("parses years and converts months to a fraction of a year", () => {
    // Implementation converts months by value / 12, so 6 Months → 0.5.
    expect(parseAge("18 Years")).toBe(18);
    expect(parseAge("6 Months")).toBe(0.5);
    expect(parseAge("12 Months")).toBe(1);
  });

  it("returns null for N/A, empty, undefined, and junk", () => {
    expect(parseAge("N/A")).toBeNull();
    expect(parseAge("")).toBeNull();
    expect(parseAge(undefined)).toBeNull();
    expect(parseAge("abc")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parsePhase
// ---------------------------------------------------------------------------

describe("parsePhase", () => {
  it("joins numeric phases with a slash", () => {
    expect(parsePhase(["PHASE1", "PHASE2"])).toBe("Phase 1/2");
    expect(parsePhase(["PHASE2"])).toBe("Phase 2");
  });

  it("returns null for NA, missing, and empty arrays", () => {
    expect(parsePhase(["NA"])).toBeNull();
    expect(parsePhase(undefined)).toBeNull();
    expect(parsePhase([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// slimStudy — correction + distance
// ---------------------------------------------------------------------------

describe("slimStudy", () => {
  it("corrects the BMC centroid site to the real building and reports a finite distance", () => {
    const summary = slimStudy(bmcStudy, DORCHESTER);
    expect(summary).not.toBeNull();
    // nearestSite must be the corrected BMC building, not the shared centroid.
    expect(summary!.nearestSite.lat).toBeCloseTo(CORRECTED.BMC.lat, 4);
    expect(summary!.nearestSite.lon).toBeCloseTo(CORRECTED.BMC.lon, 4);
    expect(summary!.nearestSite.locationPrecision).toBe("facility");
    expect(Number.isFinite(summary!.distanceMi)).toBe(true);
    expect(summary!.distanceMi).toBeGreaterThanOrEqual(0);
    // Distance should match haversine to the corrected coordinates.
    expect(summary!.distanceMi).toBeCloseTo(
      haversineMi(DORCHESTER.lat, DORCHESTER.lon, CORRECTED.BMC.lat, CORRECTED.BMC.lon),
      6,
    );
  });

  it("returns null when no site is RECRUITING + Massachusetts", () => {
    // Out-of-state site: filtered out, no qualifying location remains.
    const nyStudy = makeStudy({
      nctId: "NCT00000001",
      facility: "Some NY Hospital",
      condition: "Asthma",
      locations: [
        {
          facility: "Some NY Hospital",
          city: "New York",
          state: "New York",
          status: "RECRUITING",
          geoPoint: { lat: 40.7128, lon: -74.006 },
        },
      ],
    });
    expect(slimStudy(nyStudy, DORCHESTER)).toBeNull();

    // In-MA but COMPLETED: also filtered out.
    const completedStudy = makeStudy({
      nctId: "NCT00000002",
      facility: "Boston Medical Center",
      condition: "Asthma",
      locations: [
        {
          facility: "Boston Medical Center",
          city: "Boston",
          state: "Massachusetts",
          status: "COMPLETED",
          geoPoint: { lat: CENTROID.lat, lon: CENTROID.lon },
        },
      ],
    });
    expect(slimStudy(completedStudy, DORCHESTER)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// nearestSite
// ---------------------------------------------------------------------------

describe("nearestSite", () => {
  it("returns the global minimum-distance site for a given origin", () => {
    const sites: Site[] = [
      { name: "MGH", city: "Boston", lat: CORRECTED.MGH.lat, lon: CORRECTED.MGH.lon, locationPrecision: "facility" },
      { name: "BMC", city: "Boston", lat: CORRECTED.BMC.lat, lon: CORRECTED.BMC.lon, locationPrecision: "facility" },
      { name: "BWH", city: "Boston", lat: CORRECTED.BWH.lat, lon: CORRECTED.BWH.lon, locationPrecision: "facility" },
    ];
    // From Dorchester, BMC is the closest of the three (confirmed by brute force below).
    const expected = sites.reduce((best, s) =>
      haversineMi(DORCHESTER.lat, DORCHESTER.lon, s.lat, s.lon) <
      haversineMi(DORCHESTER.lat, DORCHESTER.lon, best.lat, best.lon)
        ? s
        : best,
    );
    expect(nearestSite(sites, DORCHESTER).name).toBe(expected.name);
    expect(nearestSite(sites, DORCHESTER).name).toBe("BMC");
  });

  it("returns the first site when origin is undefined", () => {
    const sites: Site[] = [
      { name: "A", city: "Boston", lat: 42.3, lon: -71.1, locationPrecision: "facility" },
      { name: "B", city: "Boston", lat: 42.4, lon: -71.0, locationPrecision: "facility" },
    ];
    expect(nearestSite(sites).name).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// rankBySiteDistance
// ---------------------------------------------------------------------------

describe("rankBySiteDistance", () => {
  it("produces a non-decreasing distanceMi sequence", () => {
    const summaries = ALL_FIXTURES.map((s) => slimStudy(s, DORCHESTER)).filter(
      (s): s is NonNullable<typeof s> => s !== null,
    );
    const ranked = rankBySiteDistance(summaries);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].distanceMi).toBeGreaterThanOrEqual(ranked[i - 1].distanceMi);
    }
  });
});

// ---------------------------------------------------------------------------
// buildContacts
// ---------------------------------------------------------------------------

describe("buildContacts", () => {
  it("uses central contacts when present and drops PI-without-contact", () => {
    const central = bmcStudy.protocolSection!.contactsLocationsModule!.centralContacts;
    const locations = bmcStudy.protocolSection!.contactsLocationsModule!.locations;
    const contacts = buildContacts(central, locations);
    // Only the CONTACT entry survives; the PI with no phone/email is dropped.
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("THRIVE-DM Study Team");
    // phone/email pass through verbatim.
    expect(contacts[0].phone).toBe("617-555-0101");
    expect(contacts[0].email).toBe("thrive@bmc.org");
  });

  it("falls back to site/location contacts when there is no central contact", () => {
    const central = mghLungStudy.protocolSection!.contactsLocationsModule!.centralContacts;
    const locations = mghLungStudy.protocolSection!.contactsLocationsModule!.locations;
    expect(central).toBeUndefined();
    const contacts = buildContacts(central, locations);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("MGH Lung Team");
    expect(contacts[0].phone).toBe("617-555-0202");
    expect(contacts[0].email).toBe("lung@mgh.org");
  });

  it("only pulls fallback contacts from RECRUITING + MA locations", () => {
    // A non-qualifying location's contacts must not leak into the fallback set.
    const contacts = buildContacts(undefined, [
      {
        facility: "Out of State Clinic",
        state: "New York",
        status: "RECRUITING",
        contacts: [{ name: "NY Coordinator", phone: "212-555-0000", role: "CONTACT" }],
      },
      {
        facility: "Boston Medical Center",
        state: "Massachusetts",
        status: "RECRUITING",
        contacts: [{ name: "MA Coordinator", phone: "617-555-0999", role: "CONTACT" }],
      },
    ]);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("MA Coordinator");
  });
});

// ---------------------------------------------------------------------------
// toDetail
// ---------------------------------------------------------------------------

describe("toDetail", () => {
  it("always includes an empty stops array", () => {
    const detail = toDetail(bmcStudy, DORCHESTER);
    expect(detail.stops).toEqual([]);
  });

  it("with no origin, distanceMi is 0 and nearestSite is the first corrected site", () => {
    const detail = toDetail(bmcStudy);
    expect(detail.distanceMi).toBe(0);
    // First (and only) qualifying site, corrected to the real BMC building.
    expect(detail.nearestSite.lat).toBeCloseTo(CORRECTED.BMC.lat, 4);
    expect(detail.nearestSite.lon).toBeCloseTo(CORRECTED.BMC.lon, 4);
    expect(detail.nearestSite.locationPrecision).toBe("facility");
    expect(detail.sites[0]).toEqual(detail.nearestSite);
  });

  it("carries eligibility parsed from the raw module", () => {
    const detail = toDetail(mghChampionStudy, DORCHESTER);
    expect(detail.eligibility.minAgeYears).toBe(0.5); // 6 Months
    expect(detail.eligibility.maxAgeYears).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// Properties (fast-check)
// ---------------------------------------------------------------------------

/** Arbitrary finite origin in a box around Boston. */
const bostonOrigin = fc.record({
  lat: fc.double({ min: 42.0, max: 42.7, noNaN: true }),
  lon: fc.double({ min: -71.3, max: -70.8, noNaN: true }),
});

describe("slimStudy — properties", () => {
  it("every result has a finite distanceMi ≥ 0 for any Boston-area origin", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_FIXTURES), { minLength: 0, maxLength: 10 }),
        bostonOrigin,
        (studies, origin) => {
          for (const study of studies) {
            const summary = slimStudy(study, origin);
            if (summary === null) continue;
            expect(Number.isFinite(summary.distanceMi)).toBe(true);
            expect(summary.distanceMi).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("a search result list is always sorted non-decreasing by distanceMi", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_FIXTURES), { minLength: 0, maxLength: 10 }),
        bostonOrigin,
        (studies, origin) => {
          const ranked = rankBySiteDistance(
            studies
              .map((s) => slimStudy(s, origin))
              .filter((s): s is NonNullable<typeof s> => s !== null),
          );
          for (let i = 1; i < ranked.length; i++) {
            expect(ranked[i].distanceMi).toBeGreaterThanOrEqual(ranked[i - 1].distanceMi);
          }
        },
      ),
    );
  });

  it("radius-bug guard: corrected BMC is closer to Dorchester than the uncorrected centroid", () => {
    // DEMO_DATA: the uncorrected centroid is 3.95 mi from Dorchester, so a <4 mi radius
    // drops every Boston trial. Correcting BMC to its real building pulls it strictly
    // closer, which is exactly what the fix must guarantee.
    const summary = slimStudy(bmcStudy, DORCHESTER);
    expect(summary).not.toBeNull();
    const uncorrectedDist = haversineMi(
      DORCHESTER.lat,
      DORCHESTER.lon,
      BOSTON_CENTROID.lat,
      BOSTON_CENTROID.lon,
    );
    expect(summary!.distanceMi).toBeLessThan(uncorrectedDist);
  });
});

describe("parse helpers — never throw", () => {
  it("parseAge tolerates arbitrary strings", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom(undefined) as fc.Arbitrary<string | undefined>),
        (raw) => {
          const result = parseAge(raw);
          expect(result === null || typeof result === "number").toBe(true);
        },
      ),
    );
  });

  it("parsePhase tolerates arbitrary string arrays", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.array(fc.string()), fc.constantFrom(undefined) as fc.Arbitrary<string[] | undefined>),
        (raw) => {
          const result = parsePhase(raw);
          expect(result === null || typeof result === "string").toBe(true);
        },
      ),
    );
  });
});
