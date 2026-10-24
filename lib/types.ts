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

// Neutral facts that help someone decide whether to call: what's tested, how groups are formed,
// what's measured and when, size, dates, who runs it. Built by lib/studyFacts.ts from the
// ClinicalTrials.gov record. Raw registry text (arm descriptions, outcome measures) is English.
export interface StudyArm {
  label: string;
  type: "EXPERIMENTAL" | "ACTIVE_COMPARATOR" | "PLACEBO_COMPARATOR" | "SHAM_COMPARATOR" | "NO_INTERVENTION" | "OTHER" | null;
  description: string;
}

export interface StudyOutcome {
  measure: string;
  timeFrame: string;
}

export interface StudyDate {
  date: string; // "2026-11-08" or "2027-12"
  estimated: boolean;
}

export interface StudyFacts {
  studyType: "INTERVENTIONAL" | "OBSERVATIONAL" | "EXPANDED_ACCESS" | null;
  randomized: boolean | null; // null when the registry doesn't say (always null for observational)
  masking: "NONE" | "SINGLE" | "DOUBLE" | "TRIPLE" | "QUADRUPLE" | null;
  hasPlacebo: boolean; // an arm is PLACEBO_COMPARATOR or an intervention is named placebo
  arms: StudyArm[];
  interventions: string[]; // "Behavioral: Lifestyle modification"
  primaryOutcomes: StudyOutcome[];
  secondaryOutcomeCount: number;
  enrollment: { count: number; estimated: boolean } | null;
  start: StudyDate | null;
  completion: StudyDate | null;
  lastUpdated: string | null;
  sponsor: string | null;
  collaborators: { name: string; industry: boolean }[];
}

export interface TrialDetail extends TrialSummary {
  briefSummary: string;
  eligibility: Eligibility;
  sites: Site[];
  contacts: Contact[];
  stops: Stop[];
  facts?: StudyFacts; // optional until /api/trials/[nct] fills it
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
