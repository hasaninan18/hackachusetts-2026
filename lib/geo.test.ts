import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMi, isMaZip, transitDirectionsUrl } from "./geo";
import zips from "./ma-zips.json";

describe("haversineMi", () => {
  it("matches a known distance: Dorchester 02124 centroid to MGH ≈ 5.3 mi", () => {
    expect(haversineMi(42.2859, -71.075, 42.3626, -71.0686)).toBeCloseTo(5.31, 1);
  });

  it("is symmetric, non-negative, and zero to itself", () => {
    const lat = fc.double({ min: 41, max: 43, noNaN: true });
    const lon = fc.double({ min: -73.5, max: -69.9, noNaN: true });
    fc.assert(
      fc.property(lat, lon, lat, lon, (a, b, c, d) => {
        const x = haversineMi(a, b, c, d);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeCloseTo(haversineMi(c, d, a, b), 9);
        expect(haversineMi(a, b, a, b)).toBe(0);
      }),
    );
  });
});

describe("isMaZip", () => {
  it("accepts every ZIP in the bundled Census list and rejects neighbors", () => {
    for (const z of Object.keys(zips)) expect(isMaZip(z)).toBe(true);
    for (const z of ["00999", "02899", "03101", "06103", "2124", "02124a", ""]) {
      expect(isMaZip(z)).toBe(false);
    }
  });

  it("bundled centroids are inside Massachusetts' bounding box", () => {
    for (const [lat, lon] of Object.values(zips) as [number, number][]) {
      expect(lat).toBeGreaterThan(41.18);
      expect(lat).toBeLessThan(42.89);
      expect(lon).toBeGreaterThan(-73.51);
      expect(lon).toBeLessThan(-69.85);
    }
  });
});

describe("transitDirectionsUrl", () => {
  it("builds a Google Maps transit link, with origin only when given", () => {
    const dest = { lat: 42.3359, lon: -71.1065 };
    expect(transitDirectionsUrl(dest)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=42.3359%2C-71.1065&travelmode=transit",
    );
    expect(transitDirectionsUrl(dest, { lat: 42.2859, lon: -71.075 })).toContain(
      "origin=42.2859%2C-71.075",
    );
  });
});
