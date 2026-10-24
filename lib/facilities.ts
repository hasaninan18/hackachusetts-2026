// Boston geoPoint fix for TrialPath MA (spec: trial-search-api).
//
// ClinicalTrials.gov API v2 returns the SAME geoPoint for every Boston site:
// 42.35843, -71.05977 (the city centroid). That breaks distance ranking and the
// "nearest T stop" lookup — from Dorchester the centroid is ~4 mi away, so radii
// under ~4 mi drop every Boston trial (see docs/DEMO_DATA.md).
//
// This module is a PURE override layer: given a facility name and the API geoPoint,
// it returns the corrected building coordinates and a locationPrecision. No I/O.
//
// Coordinates are the "Use" column from docs/DEMO_DATA.md (independently re-verified
// against the US Census geocoder on 2026-10-24; none more than 0.2 mi from the Census
// result). Do not modify Neil's lib/types.ts — we only import from it.

import type { Site } from "./types";

/** The single centroid ClinicalTrials.gov assigns to every Boston site. */
export const BOSTON_CENTROID = { lat: 42.35843, lon: -71.05977 } as const;

/**
 * ~0.001° ≈ 0.07 mi. The upstream value is a fixed constant, so a tight epsilon is
 * enough to recognize it while tolerating float formatting.
 */
const CENTROID_EPSILON = 1e-3;

export interface FacilityOverride {
  /** Corrected latitude (docs/DEMO_DATA.md "Use" column). */
  lat: number;
  /** Corrected longitude. */
  lon: number;
  /**
   * Normalized substrings to match against the normalized facility name.
   * From docs/DEMO_DATA.md: brigham, boston medical center, beth israel / bidmc,
   * massachusetts general / mgh, boston children.
   */
  aliases: string[];
}

/** Corrected coordinates for the big Boston hospitals used in the demo. */
export const FACILITY_OVERRIDES: readonly FacilityOverride[] = [
  { lat: 42.335, lon: -71.0728, aliases: ["boston medical center"] },
  { lat: 42.3355, lon: -71.1067, aliases: ["brigham"] },
  { lat: 42.3396, lon: -71.1066, aliases: ["beth israel", "bidmc"] },
  { lat: 42.3625, lon: -71.0694, aliases: ["massachusetts general", "mgh"] },
  { lat: 42.3377, lon: -71.1057, aliases: ["boston children"] },
];

/**
 * Normalize a facility name for substring matching:
 * lowercase, "&" → "and", strip punctuation, collapse whitespace.
 */
export function normalizeName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a geoPoint is (within epsilon) the shared Boston centroid. */
export function isBostonCentroid(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return (
    Math.abs(lat - BOSTON_CENTROID.lat) < CENTROID_EPSILON &&
    Math.abs(lon - BOSTON_CENTROID.lon) < CENTROID_EPSILON
  );
}

/** Find the override whose any alias is a substring of the normalized name. */
export function matchOverride(name: string): FacilityOverride | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  for (const override of FACILITY_OVERRIDES) {
    if (override.aliases.some((alias) => normalized.includes(alias))) return override;
  }
  return null;
}

export interface CorrectedPoint {
  lat: number;
  lon: number;
  /** Matches Site.locationPrecision in lib/types.ts. */
  precision: Site["locationPrecision"];
}

/**
 * Correct a site's coordinates (pure, total — never throws).
 *
 * Rules (spec trial-search-api, Requirement 3):
 *  - geoPoint is NOT the Boston centroid      → keep API coords, precision "facility"
 *    (the API already geocoded a real point).
 *  - geoPoint IS the centroid + name matches  → override coords,  precision "facility".
 *  - geoPoint IS the centroid + no match      → centroid coords,  precision "city".
 *  - non-finite input                         → centroid coords,  precision "city" (defensive).
 *
 * The centroid-but-unmatched case stays "city" so a later layer (ZIP centroid from
 * lib/ma-zips.json, handled outside this spec) can downgrade it to "zip" if desired.
 */
export function correctCoordinates(name: string, lat: number, lon: number): CorrectedPoint {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { lat: BOSTON_CENTROID.lat, lon: BOSTON_CENTROID.lon, precision: "city" };
  }

  if (!isBostonCentroid(lat, lon)) {
    return { lat, lon, precision: "facility" };
  }

  const override = matchOverride(name);
  if (override) {
    return { lat: override.lat, lon: override.lon, precision: "facility" };
  }

  return { lat, lon, precision: "city" };
}
