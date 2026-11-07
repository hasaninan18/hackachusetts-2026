// Data-quality report over a national snapshot (docs/NATIONAL_PLAN.md §2, §3, §9).
//
// PURE. Answers the questions Phase A needs before the database goes live:
//  - How many US sites sit on a shared "city centroid" point? (The Boston bug, generalized:
//    ClinicalTrials.gov geocodes many sites to their city, not their building.)
//  - How many sites have no coordinates at all?
//  - How many trials ask for English in their eligibility text?

import { normalizeName } from "../facilities";
import type { SiteRow, TrialRow } from "./ctgov";

/** A point shared by at least this many distinct facility names is treated as a city centroid. */
export const SHARED_POINT_MIN_FACILITIES = 3;

export interface SharedPoint {
  lat: number;
  lon: number;
  city: string;
  state: string;
  facilities: number;
  sites: number;
}

/**
 * Points (rounded to 4 decimals, ~11 m) that several distinct facilities report. ZIP-centroid
 * placements are excluded: those are known-approximate on purpose. Largest first.
 */
export function sharedPoints(sites: SiteRow[]): SharedPoint[] {
  const groups = new Map<string, { site: SiteRow; names: Set<string>; sites: number }>();
  for (const site of sites) {
    if (site.locationPrecision === "zip") continue;
    const key = `${site.lat.toFixed(4)},${site.lon.toFixed(4)}`;
    let g = groups.get(key);
    if (!g) {
      g = { site, names: new Set(), sites: 0 };
      groups.set(key, g);
    }
    g.names.add(normalizeName(site.name));
    g.sites++;
  }
  return [...groups.values()]
    .filter((g) => g.names.size >= SHARED_POINT_MIN_FACILITIES)
    .map((g) => ({
      lat: Number(g.site.lat.toFixed(4)),
      lon: Number(g.site.lon.toFixed(4)),
      city: g.site.city,
      state: g.site.state,
      facilities: g.names.size,
      sites: g.sites,
    }))
    .sort((a, b) => b.sites - a.sites || a.city.localeCompare(b.city));
}

/**
 * Relabel every site on a {@link sharedPoints} point as precision "city". correctCoordinates
 * only recognizes Boston's centroid, so elsewhere it calls these pins "facility" — but in the
 * 2026-11-01 snapshot 3,128 of 3,138 US cities had exactly one point for all their sites.
 * Returns new rows; the input is not mutated.
 */
export function markSharedPointsAsCity<R extends { sites: SiteRow[] }>(rows: R[]): R[] {
  const shared = new Set(
    sharedPoints(rows.flatMap((r) => r.sites)).map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`),
  );
  return rows.map((r) => ({
    ...r,
    sites: r.sites.map((s) =>
      s.locationPrecision !== "zip" && shared.has(`${s.lat.toFixed(4)},${s.lon.toFixed(4)}`)
        ? { ...s, locationPrecision: "city" as const }
        : s,
    ),
  }));
}

const ENGLISH = /\benglish\b/i;

/**
 * Eligibility phrasing that makes English a condition of joining: "able to speak/read/
 * understand English", "English-speaking", "English proficiency", or excluding
 * "non-English speakers". A report heuristic, NOT the user-facing English-only flag.
 */
const ENGLISH_REQUIRED = new RegExp(
  [
    String.raw`\b(?:speak|speaks|speaking|read|reads|write|writes|understand|understands|comprehend|fluent|fluency|proficient|proficiency|literate|literacy|communicate)\b[^.;\n]{0,60}\benglish\b`,
    String.raw`\benglish[- ]?(?:speaking|speaker|speakers|proficien\w*|fluen\w*|litera\w*|language)\b`,
    String.raw`\bnon[- ]?english\b`,
  ].join("|"),
  "i",
);

/** "English or Spanish", "English and/or Spanish", "English/Spanish": another language also works. */
const ENGLISH_OR_OTHER =
  /\benglish\s*(?:,|or|and\/or|\/)\s*(?:spanish|french|chinese|mandarin|cantonese|portuguese|vietnamese|korean|arabic|russian|haitian|creole|another language)\b|\b(?:spanish|french|chinese|mandarin|cantonese|portuguese|vietnamese|korean|arabic|russian|haitian|creole)\s*(?:or|and\/or|\/)\s*english\b/i;

export type EnglishClass = "none" | "mentions" | "required" | "required-or-other";

export function classifyEnglish(criteriaText: string): EnglishClass {
  if (typeof criteriaText !== "string" || !ENGLISH.test(criteriaText)) return "none";
  if (!ENGLISH_REQUIRED.test(criteriaText)) return "mentions";
  return ENGLISH_OR_OTHER.test(criteriaText) ? "required-or-other" : "required";
}

export interface QualityReport {
  trials: number;
  sites: number;
  sitesByState: Record<string, number>;
  sitesByPrecision: Record<string, number>;
  sitesDroppedNoLocation: number;
  sitesOnSharedPoints: number;
  sharedPointCount: number;
  topSharedPoints: SharedPoint[];
  english: Record<EnglishClass, number>;
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function qualityReport(
  rows: { trial: TrialRow; sites: SiteRow[] }[],
  sitesDroppedNoLocation = 0,
  top = 25,
): QualityReport {
  const allSites = rows.flatMap((r) => r.sites);
  const sitesByState: Record<string, number> = {};
  const sitesByPrecision: Record<string, number> = {};
  for (const s of allSites) {
    bump(sitesByState, s.state || "?");
    bump(sitesByPrecision, s.locationPrecision);
  }
  const english: Record<EnglishClass, number> = {
    none: 0,
    mentions: 0,
    required: 0,
    "required-or-other": 0,
  };
  for (const { trial } of rows) english[classifyEnglish(trial.eligibility?.eligibilityCriteria ?? "")]++;

  const shared = sharedPoints(allSites);
  return {
    trials: rows.length,
    sites: allSites.length,
    sitesByState: Object.fromEntries(Object.entries(sitesByState).sort((a, b) => b[1] - a[1])),
    sitesByPrecision,
    sitesDroppedNoLocation,
    sitesOnSharedPoints: shared.reduce((n, p) => n + p.sites, 0),
    sharedPointCount: shared.length,
    topSharedPoints: shared.slice(0, top),
    english,
  };
}
