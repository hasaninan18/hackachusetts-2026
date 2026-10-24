// Boston geoPoint fix (spec: trial-search-api, Requirement 3).
//
// ClinicalTrials.gov geocodes every Boston site to the shared city centroid
// (42.35843, -71.05977). That collapses five distinct demo hospitals onto one
// point and places them ~4 mi from Dorchester, so small search radii drop every
// Boston trial. This module corrects those coordinates to the real building using
// the "Use" column from docs/DEMO_DATA.md, matched by facility name.
//
// Everything here is PURE and total: no fetch, no clock, no randomness. Any string
// + any numbers map to a CorrectedPoint and never throw (structure.md: pure logic in lib/).

import type { Site } from "./types";

/** The shared Boston city centroid every Boston site reports from the upstream API. */
export const BOSTON_CENTROID = { lat: 42.35843, lon: -71.05977 } as const;

/** Degrees of tolerance when comparing a geoPoint to {@link BOSTON_CENTROID}. ~0.07 mi. */
const CENTROID_EPSILON = 1e-3;

interface FacilityOverride {
  lat: number;
  lon: number;
  /** Normalized substrings (see {@link normalizeName}) matched against a facility name. */
  aliases: string[];
  /**
   * Normalized substrings that VETO a match even when an alias hits. Lets a broad
   * alias like "brigham" claim the main hospital while excluding distinct sister
   * campuses that share the brand — e.g. "Brigham and Women's Faulkner Hospital",
   * a separate Jamaica Plain hospital ~2 mi from the main Longwood campus.
   */
  excludeAliases?: string[];
}

/**
 * Corrected "Use" coordinates from docs/DEMO_DATA.md, keyed by normalized name aliases.
 * Aliases are already normalized (lowercase, no punctuation) so matching is a plain
 * substring test against the normalized facility name.
 */
export const FACILITY_OVERRIDES: FacilityOverride[] = [
  { lat: 42.335, lon: -71.0728, aliases: ["boston medical center"] },
  { lat: 42.3355, lon: -71.1067, aliases: ["brigham"], excludeAliases: ["faulkner"] },
  { lat: 42.3396, lon: -71.1066, aliases: ["beth israel", "bidmc"] },
  { lat: 42.3625, lon: -71.0694, aliases: ["massachusetts general", "mgh"] },
  { lat: 42.3377, lon: -71.1057, aliases: ["boston children"] },
];

/** Corrected geoPoint plus how precise it is (mirrors `Site["locationPrecision"]`). */
export interface CorrectedPoint {
  lat: number;
  lon: number;
  precision: Site["locationPrecision"];
}

/**
 * Normalize a facility name for alias matching: lowercase, `&` → `and`, strip
 * punctuation, collapse runs of whitespace. Total — non-string input yields `""`.
 */
export function normalizeName(name: string): string {
  if (typeof name !== "string") return "";
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    // Drop anything that isn't a letter, number, or whitespace (punctuation, symbols).
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `(lat, lon)` equals {@link BOSTON_CENTROID} within {@link CENTROID_EPSILON}.
 * Non-finite inputs are never the centroid (returns `false`).
 */
export function isBostonCentroid(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return (
    Math.abs(lat - BOSTON_CENTROID.lat) <= CENTROID_EPSILON &&
    Math.abs(lon - BOSTON_CENTROID.lon) <= CENTROID_EPSILON
  );
}

/**
 * Correct a site's coordinates using its facility name and API geoPoint (Requirement 3).
 *
 * Pure and total — any string + any numbers map to a {@link CorrectedPoint}, never throws:
 *  - non-finite input          → `{ centroid coords, "city" }` (defensive fallback)
 *  - not the Boston centroid    → `{ api coords, "facility" }` (API geocoded a real point)
 *  - centroid + alias hit, not vetoed → `{ override coords, "facility" }`
 *  - centroid + alias hit but a sister-campus veto (e.g. "faulkner") → falls through
 *  - centroid + no name hit     → `{ centroid coords, "city" }`
 */
export function correctCoordinates(name: string, lat: number, lon: number): CorrectedPoint {
  // Defensive: non-finite coordinates can't be trusted or measured — fall back to "city".
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { lat: BOSTON_CENTROID.lat, lon: BOSTON_CENTROID.lon, precision: "city" };
  }

  // The API already geocoded a distinct building; keep it.
  if (!isBostonCentroid(lat, lon)) {
    return { lat, lon, precision: "facility" };
  }

  // Shared centroid: try to recover the real building from the facility name.
  const normalized = normalizeName(name);
  if (normalized) {
    for (const override of FACILITY_OVERRIDES) {
      const vetoed = override.excludeAliases?.some((alias) => normalized.includes(alias)) ?? false;
      if (!vetoed && override.aliases.some((alias) => normalized.includes(alias))) {
        return { lat: override.lat, lon: override.lon, precision: "facility" };
      }
    }
  }

  // Centroid with no name match: leave it at the city centroid.
  return { lat: BOSTON_CENTROID.lat, lon: BOSTON_CENTROID.lon, precision: "city" };
}
