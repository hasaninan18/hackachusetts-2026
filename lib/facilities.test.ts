import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BOSTON_CENTROID,
  FACILITY_OVERRIDES,
  correctCoordinates,
  isBostonCentroid,
  normalizeName,
  type CorrectedPoint,
} from "./facilities";

// Every Boston site reports from this shared centroid upstream.
const { lat: CLAT, lon: CLON } = BOSTON_CENTROID;

describe("normalizeName", () => {
  it("lowercases, maps & → and, strips punctuation, collapses whitespace", () => {
    // Punctuation (including the apostrophe) becomes a space, then whitespace collapses.
    expect(normalizeName("Brigham & Women's Hospital")).toBe("brigham and women s hospital");
    expect(normalizeName("  Beth-Israel   (BIDMC)  ")).toBe("beth israel bidmc");
  });

  it("returns '' for non-string input", () => {
    // normalizeName is total; defend against malformed upstream data.
    expect(normalizeName(undefined as unknown as string)).toBe("");
    expect(normalizeName(null as unknown as string)).toBe("");
    expect(normalizeName(42 as unknown as string)).toBe("");
  });
});

describe("isBostonCentroid", () => {
  it("is true at the centroid and within epsilon, false far away", () => {
    expect(isBostonCentroid(CLAT, CLON)).toBe(true);
    expect(isBostonCentroid(CLAT + 1e-4, CLON - 1e-4)).toBe(true);
    expect(isBostonCentroid(42.335, -71.0728)).toBe(false);
  });

  it("is false for non-finite coordinates", () => {
    expect(isBostonCentroid(NaN, CLON)).toBe(false);
    expect(isBostonCentroid(CLAT, Infinity)).toBe(false);
  });
});

describe("correctCoordinates — facility alias overrides at the Boston centroid", () => {
  // Each demo hospital name, reported at the shared centroid, must correct to its
  // DEMO_DATA "Use" coordinates with precision "facility".
  const cases: ReadonlyArray<{ name: string; lat: number; lon: number }> = [
    { name: "Boston Medical Center", lat: 42.335, lon: -71.0728 },
    { name: "Brigham and Women's Hospital", lat: 42.3355, lon: -71.1067 },
    { name: "Beth Israel Deaconess Medical Center", lat: 42.3396, lon: -71.1066 },
    { name: "BIDMC", lat: 42.3396, lon: -71.1066 },
    { name: "Massachusetts General Hospital", lat: 42.3625, lon: -71.0694 },
    { name: "MGH", lat: 42.3625, lon: -71.0694 },
    { name: "Boston Children's Hospital", lat: 42.3377, lon: -71.1057 },
  ];

  for (const { name, lat, lon } of cases) {
    it(`corrects "${name}" to ${lat}, ${lon} with precision "facility"`, () => {
      const result = correctCoordinates(name, CLAT, CLON);
      expect(result).toEqual<CorrectedPoint>({ lat, lon, precision: "facility" });
    });
  }
});

describe("correctCoordinates — Faulkner must not inherit the main Brigham override (issue #4)", () => {
  const { lat: CLAT2, lon: CLON2 } = BOSTON_CENTROID;
  const MAIN_BRIGHAM = { lat: 42.3355, lon: -71.1067 };

  it("corrects the MAIN Brigham hospital to its campus coordinates", () => {
    // The main Longwood hospital must still match so its distances stay correct.
    expect(correctCoordinates("Brigham and Women's Hospital", CLAT2, CLON2)).toEqual<CorrectedPoint>({
      ...MAIN_BRIGHAM,
      precision: "facility",
    });
    expect(correctCoordinates("Brigham & Women's Hospital", CLAT2, CLON2)).toEqual<CorrectedPoint>({
      ...MAIN_BRIGHAM,
      precision: "facility",
    });
  });

  it("does NOT give Faulkner the main Brigham override (stays city at the centroid)", () => {
    // "Brigham and Women's Faulkner Hospital" is a separate Jamaica Plain hospital.
    // The "faulkner" veto must stop the broad "brigham" alias from claiming it.
    for (const name of [
      "Brigham and Women's Faulkner Hospital",
      "Brigham & Women's Faulkner Hospital",
      "BWH Faulkner",
      "Faulkner Hospital (Brigham and Women's)",
    ]) {
      const result = correctCoordinates(name, CLAT2, CLON2);
      expect(result).not.toEqual(expect.objectContaining(MAIN_BRIGHAM));
      // No Faulkner override exists, so it correctly falls through to the city centroid.
      expect(result).toEqual<CorrectedPoint>({ lat: CLAT2, lon: CLON2, precision: "city" });
    }
  });

  it("keeps a Faulkner site's distinct API geoPoint when it is not the centroid", () => {
    // If the API already geocoded Faulkner to a real point, pass it through untouched.
    const faulknerPoint = { lat: 42.3015, lon: -71.1278 }; // JP, well off the centroid
    expect(
      correctCoordinates("Brigham and Women's Faulkner Hospital", faulknerPoint.lat, faulknerPoint.lon),
    ).toEqual<CorrectedPoint>({ ...faulknerPoint, precision: "facility" });
  });
});

describe("correctCoordinates — centroid + unknown name → city", () => {
  it("keeps the centroid coords with precision 'city'", () => {
    const result = correctCoordinates("Some Random Clinic", CLAT, CLON);
    expect(result).toEqual<CorrectedPoint>({ lat: CLAT, lon: CLON, precision: "city" });
  });

  it("empty name at the centroid stays at the centroid as 'city'", () => {
    const result = correctCoordinates("", CLAT, CLON);
    expect(result).toEqual<CorrectedPoint>({ lat: CLAT, lon: CLON, precision: "city" });
  });
});

describe("correctCoordinates — non-centroid coords returned unchanged", () => {
  it("passes through a distinct geocoded point as 'facility'", () => {
    const result = correctCoordinates("Boston Medical Center", 42.2859, -71.075);
    // Even a known alias is ignored when the API already gave a distinct building.
    expect(result).toEqual<CorrectedPoint>({ lat: 42.2859, lon: -71.075, precision: "facility" });
  });

  it("non-finite coords fall back to 'city' at the centroid", () => {
    expect(correctCoordinates("MGH", NaN, CLON)).toEqual<CorrectedPoint>({
      lat: CLAT,
      lon: CLON,
      precision: "city",
    });
  });
});

describe("correctCoordinates — properties", () => {
  it("never throws on arbitrary strings and numbers", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom(undefined, null) as fc.Arbitrary<unknown>),
        fc.oneof(fc.double(), fc.integer(), fc.constantFrom(NaN, Infinity, -Infinity)),
        fc.oneof(fc.double(), fc.integer(), fc.constantFrom(NaN, Infinity, -Infinity)),
        (name, lat, lon) => {
          const result = correctCoordinates(name as string, lat, lon);
          expect(typeof result.lat).toBe("number");
          expect(typeof result.lon).toBe("number");
          expect(["facility", "zip", "city"]).toContain(result.precision);
        },
      ),
    );
  });

  it("returns non-centroid finite coordinates unchanged with precision 'facility'", () => {
    // Generate finite coordinates that are guaranteed outside the centroid epsilon.
    const offCentroidLat = fc
      .double({ min: 40, max: 44, noNaN: true })
      .filter((lat) => Math.abs(lat - CLAT) > 1e-2);
    const offCentroidLon = fc
      .double({ min: -74, max: -69, noNaN: true })
      .filter((lon) => Math.abs(lon - CLON) > 1e-2);

    fc.assert(
      fc.property(fc.string(), offCentroidLat, offCentroidLon, (name, lat, lon) => {
        const result = correctCoordinates(name, lat, lon);
        expect(result.lat).toBe(lat);
        expect(result.lon).toBe(lon);
        expect(result.precision).toBe("facility");
      }),
    );
  });
});

describe("FACILITY_OVERRIDES integrity", () => {
  it("every alias is already normalized (matching is a plain substring test)", () => {
    for (const override of FACILITY_OVERRIDES) {
      for (const alias of override.aliases) {
        expect(normalizeName(alias)).toBe(alias);
      }
    }
  });
});
