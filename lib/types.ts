// Shared contract between the frontend and the /api routes. See docs/FRONTEND_PLAN.md §3.

export type Sex = "ALL" | "FEMALE" | "MALE";

export const LANGS = ["en", "es", "pt", "ht", "zh", "vi"] as const;
export type Lang = (typeof LANGS)[number];

export interface Site {
  name: string;
  city: string;
  zip?: string;
  lat: number;
  lon: number;
  // ClinicalTrials.gov geoPoints are geocoded to the city (every Boston site is 42.35843,-71.05977).
  // "facility" = real building coordinates, "zip" = ZIP centroid, "city" = API value as-is.
  locationPrecision: "facility" | "zip" | "city";
}

export interface TrialSummary {
  nctId: string;
  title: string;
  conditions: string[];
  phase: string | null; // e.g. "Phase 2", null for "NA" / not given
  nearestSite: Site;
  distanceMi: number;
}

export interface Eligibility {
  minAgeYears: number | null;
  maxAgeYears: number | null;
  sex: Sex;
  healthyVolunteers: boolean;
  criteriaText: string;
}

export type RouteType = 0 | 1 | 2 | 3; // 0 light rail (Green, Mattapan), 1 subway, 2 commuter rail, 3 bus

export interface Line {
  name: string; // "Red Line", "Green Line E", "Bus 39"
  color: string; // MBTA route color, "#DA291C"
}

export interface Stop {
  id: string; // parent station id when there is one, e.g. "place-chmnl"
  name: string;
  routeType: RouteType;
  lines: Line[];
  wheelchair: boolean | null; // wheelchair_boarding 1 → true, 2 → false, 0 → null
  walkMi: number;
}

export interface Contact {
  name?: string;
  phone?: string;
  email?: string;
}

export interface TrialDetail extends TrialSummary {
  briefSummary: string;
  eligibility: Eligibility;
  sites: Site[];
  contacts: Contact[];
  stops: Stop[];
}

export interface FitQuestion {
  id: string;
  text: string;
  ruleOutIf: "yes" | "no";
}

export interface Simplified {
  lang: Lang;
  whatItStudies: string;
  whatYouDo: string;
  timeCommitment: string;
  questions: FitQuestion[]; // 3–6
}

export interface TrialsResponse {
  trials: TrialSummary[];
  total: number;
}
