// Which part of the US TrialPath serves (docs/NATIONAL_PLAN.md §2).
//
// The deployment picks one region at build time via NEXT_PUBLIC_TRIALPATH_REGION
// ("ma" | "new-england" | "us"); anything else falls back to "ma" so the live MA site never
// changes by accident. Everything here is PURE and total (structure.md: pure logic in lib/).

/** USPS code → the full state name ClinicalTrials.gov uses in `LocationState`. */
export const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
} as const;

export type StateCode = keyof typeof US_STATES;
export type RegionId = "ma" | "new-england" | "us";

export interface Region {
  id: RegionId;
  /** USPS codes of the states served. */
  states: readonly StateCode[];
}

const ALL_STATES = Object.keys(US_STATES) as StateCode[];

export const REGIONS: Record<RegionId, Region> = {
  ma: { id: "ma", states: ["MA"] },
  "new-england": { id: "new-england", states: ["MA", "CT", "RI", "NH", "VT", "ME"] },
  us: { id: "us", states: ALL_STATES },
};

/** ClinicalTrials.gov's `LocationCountry` value for US sites. */
const UNITED_STATES = "United States";

/** Resolve a raw region id to a {@link Region}; unknown or missing → `ma`. Total. */
export function resolveRegion(raw: string | undefined): Region {
  return raw !== undefined && Object.hasOwn(REGIONS, raw) ? REGIONS[raw as RegionId] : REGIONS.ma;
}

/**
 * The region this build serves. A direct `process.env.NEXT_PUBLIC_…` reference so Next.js
 * inlines it into the client bundle at build time (environment-variables.md).
 */
export const ACTIVE_REGION: Region = resolveRegion(process.env.NEXT_PUBLIC_TRIALPATH_REGION);

/** True when a USPS state code is served by `region`. */
export function regionHasStateCode(region: Region, code: string): boolean {
  return (region.states as readonly string[]).includes(code);
}

/**
 * True when a raw ClinicalTrials.gov location (full state name, optional country) is inside
 * `region`. A location with a country must be in the United States; fixtures and older
 * responses without a country are judged by state alone. Total.
 */
export function locationInRegion(
  region: Region,
  loc: { state?: string; country?: string },
): boolean {
  if (loc.country !== undefined && loc.country !== UNITED_STATES) return false;
  if (typeof loc.state !== "string") return false;
  return region.states.some((code) => US_STATES[code] === loc.state);
}
