// Parse / slim / rank for TrialPath MA (spec: trial-search-api, Task 4).
//
// Everything here is PURE and total: no fetch, no clock, no randomness. Route handlers
// (app/api/trials/**) do all I/O and delegate every parse/correct/rank decision to these
// helpers (structure.md: pure logic in lib/, I/O in routes). All distances are MILES —
// lib/ is canonical miles (structure.md) — and no function throws on malformed upstream
// data; each one defaults/guards defensively.

import type {
  CtgContact,
  CtgEligibilityModule,
  CtgLocation,
  CtgStudy,
} from "./api-types";
import { correctCoordinates } from "./facilities";
import { haversineMi } from "./geo";
import type { Contact, Eligibility, Sex, Site, TrialDetail, TrialSummary } from "./types";

/** ClinicalTrials.gov API v2 studies endpoint. */
const CTG_BASE = "https://clinicaltrials.gov/api/v2/studies";

/** Minimum (and default) search radius in miles — see {@link normalizeRadius}. */
const MIN_RADIUS_MI = 5;

/**
 * The exact `fields` list requested from ClinicalTrials.gov (Requirement 1.1). No
 * speculative fields: every entry maps to something lib/clinicaltrials.ts consumes.
 */
const CTG_FIELDS = [
  "NCTId",
  "BriefTitle",
  "Condition",
  "Phase",
  "BriefSummary",
  "EligibilityModule",
  "LocationFacility",
  "LocationCity",
  "LocationState",
  "LocationGeoPoint",
  "LocationStatus",
  "LocationContactName",
  "LocationContactPhone",
  "LocationContactEMail",
  "CentralContactName",
  "CentralContactPhone",
  "CentralContactEMail",
] as const;

/** Per-site status that qualifies a location (BACKEND_NOTES.md §2). */
const RECRUITING = "RECRUITING";
/** Per-site state that qualifies a location (BACKEND_NOTES.md §2). */
const MASSACHUSETTS = "Massachusetts";

/** Contact role dropped when it carries no phone or email (safety.md §5, BACKEND_NOTES §5). */
const PRINCIPAL_INVESTIGATOR = "PRINCIPAL_INVESTIGATOR";

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/**
 * Normalize a raw `radius` value to miles (Requirement 1.2). Returns `Math.max(5, n)`
 * for a finite `n ≥ 5`; anything missing, non-numeric, or below 5 defaults to 5 — the
 * Boston centroid sits ~4 mi from Dorchester, so smaller radii drop every Boston trial
 * (docs/DEMO_DATA.md). Total: never throws.
 */
export function normalizeRadius(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && n >= MIN_RADIUS_MI) return Math.max(MIN_RADIUS_MI, n);
  return MIN_RADIUS_MI;
}

/**
 * Build the ClinicalTrials.gov v2 search URL (Requirement 1.1) with the exact params and
 * {@link CTG_FIELDS}. `radius` is normalized via {@link normalizeRadius}. An empty/missing
 * `cond` is a location-only search (Requirement 1.8), sent as an empty `query.cond`.
 */
export function buildSearchUrl({
  cond,
  lat,
  lon,
  radius,
}: {
  cond?: string;
  lat: number;
  lon: number;
  radius?: unknown;
}): string {
  const r = normalizeRadius(radius);
  const params = new URLSearchParams();
  params.set("query.cond", cond ?? "");
  params.set("filter.overallStatus", RECRUITING);
  params.set("filter.geo", `distance(${lat},${lon},${r}mi)`);
  params.set("pageSize", "50");
  params.set("fields", CTG_FIELDS.join(","));
  return `${CTG_BASE}?${params.toString()}`;
}

/**
 * Build the single-study URL for one NCT ID, requesting the same {@link CTG_FIELDS}.
 * Uses `query.id` so the response comes back in the same `{ studies: [...] }` shape as
 * search, keeping the route handler's parsing uniform.
 */
export function buildDetailUrl(nctId: string): string {
  const params = new URLSearchParams();
  params.set("query.id", nctId);
  params.set("fields", CTG_FIELDS.join(","));
  return `${CTG_BASE}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

/**
 * Parse an eligibility age string to years (BACKEND_NOTES §7). `"18 Years"` → `18`,
 * `"6 Months"` → `0.5` (months / 12). `"N/A"`, empty, `undefined`, or junk → `null`.
 * Total: never throws.
 */
export function parseAge(raw: string | undefined): number | null {
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(year|month)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  return unit === "month" ? value / 12 : value;
}

/**
 * Parse a phases array into a display string (BACKEND_NOTES §7). `["PHASE2"]` → `"Phase 2"`,
 * `["PHASE1","PHASE2"]` → `"Phase 1/2"`. `"NA"`/`"EARLY_PHASE1"` without a numeric phase,
 * missing, or empty → `null`. Total: never throws.
 */
export function parsePhase(phases: string[] | undefined): string | null {
  if (!Array.isArray(phases)) return null;
  const numbers = phases
    .map((p) => (typeof p === "string" ? p.trim().toUpperCase() : ""))
    .map((p) => {
      const m = p.match(/^PHASE(\d+)$/);
      return m ? m[1] : null;
    })
    .filter((n): n is string => n !== null);
  if (numbers.length === 0) return null;
  return `Phase ${numbers.join("/")}`;
}

// ---------------------------------------------------------------------------
// Site correction / filtering
// ---------------------------------------------------------------------------

/**
 * Build a {@link Site} from one raw location, correcting its coordinates via
 * {@link correctCoordinates} (the Boston geoPoint fix, Requirement 3). Keeps the facility
 * name, city, and zip; lat/lon/locationPrecision come from the corrected point. Total.
 */
export function correctSite(rawLocation: CtgLocation): Site {
  const name = rawLocation.facility ?? "";
  const geo = rawLocation.geoPoint;
  const corrected = correctCoordinates(name, geo?.lat ?? NaN, geo?.lon ?? NaN);
  const site: Site = {
    name,
    city: rawLocation.city ?? "",
    lat: corrected.lat,
    lon: corrected.lon,
    locationPrecision: corrected.precision,
  };
  if (rawLocation.zip !== undefined) site.zip = rawLocation.zip;
  return site;
}

/** True when a raw location is recruiting AND in Massachusetts (BACKEND_NOTES §2). */
function isRecruitingMaLocation(loc: CtgLocation): boolean {
  return loc.status === RECRUITING && loc.state === MASSACHUSETTS;
}

/**
 * Correct every qualifying location into a {@link Site} (Requirement 1.3): keep only
 * locations whose own `status === "RECRUITING"` AND `state === "Massachusetts"`. Returns
 * corrected `Site[]` (possibly empty). Total.
 */
export function recruitingMaSites(rawLocations: CtgLocation[] | undefined): Site[] {
  if (!Array.isArray(rawLocations)) return [];
  return rawLocations.filter(isRecruitingMaLocation).map(correctSite);
}

/**
 * Return the {@link Site} minimizing {@link haversineMi} to `origin` (Requirement 4.1).
 * When `origin` is undefined, return the first site — a detail request without lat/lon
 * uses the first qualifying site (Requirement 2.3). Callers filter to a non-empty array
 * first; if `sites` is empty this throws per the caller's contract, so slimStudy/toDetail
 * guard against empty input before calling.
 */
export function nearestSite(sites: Site[], origin?: { lat: number; lon: number }): Site {
  if (!origin) return sites[0];
  let best = sites[0];
  let bestDist = haversineMi(origin.lat, origin.lon, best.lat, best.lon);
  for (let i = 1; i < sites.length; i++) {
    const d = haversineMi(origin.lat, origin.lon, sites[i].lat, sites[i].lon);
    if (d < bestDist) {
      best = sites[i];
      bestDist = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/** True when a contact carries a non-empty phone or email string. */
function hasPhoneOrEmail(c: CtgContact): boolean {
  return (
    (typeof c.phone === "string" && c.phone.trim() !== "") ||
    (typeof c.email === "string" && c.email.trim() !== "")
  );
}

/** Map a raw contact to the domain {@link Contact}, passing phone/email through verbatim. */
function toContact(c: CtgContact): Contact {
  const out: Contact = {};
  if (typeof c.name === "string" && c.name !== "") out.name = c.name;
  if (typeof c.phone === "string" && c.phone !== "") out.phone = c.phone;
  if (typeof c.email === "string" && c.email !== "") out.email = c.email;
  return out;
}

/**
 * Filter a raw contact list to the ones worth showing (safety.md §5, BACKEND_NOTES §5):
 * prefer entries with a phone or email, and drop PRINCIPAL_INVESTIGATOR entries that have
 * neither. Phone/email values pass through unchanged.
 */
function usableContacts(raw: CtgContact[]): CtgContact[] {
  return raw.filter((c) => {
    if (hasPhoneOrEmail(c)) return true;
    // No phone/email: keep only non-PI entries (a PI with no contact is useless).
    return c.role !== PRINCIPAL_INVESTIGATOR;
  });
}

/**
 * Build the trial's {@link Contact} list (Requirement 2.7).
 *
 * Signature: takes the study's raw central contacts AND the study's raw locations (not the
 * corrected `Site[]`), because the site/location fallback needs each location's raw
 * `.contacts` (LocationContactName/Phone/EMail). Locations are filtered internally to the
 * recruiting-MA set, mirroring {@link recruitingMaSites}.
 *
 * Rules: use the study's CENTRAL contacts when any has a phone or email; otherwise fall
 * back to the site/location contacts from the qualifying MA sites. In both cases prefer
 * entries that have a phone or email, drop PI-without-contact entries, and pass phone/email
 * strings through unchanged. Total: never throws.
 */
export function buildContacts(
  centralContacts: CtgContact[] | undefined,
  rawLocations: CtgLocation[] | undefined,
): Contact[] {
  const central = Array.isArray(centralContacts) ? centralContacts : [];
  // Use central contacts when at least one carries a phone or email.
  if (central.some(hasPhoneOrEmail)) {
    return usableContacts(central).map(toContact);
  }

  // Fall back to site/location contacts from the qualifying MA sites.
  const locations = Array.isArray(rawLocations) ? rawLocations : [];
  const siteContacts = locations
    .filter(isRecruitingMaLocation)
    .flatMap((loc) => (Array.isArray(loc.contacts) ? loc.contacts : []));
  return usableContacts(siteContacts).map(toContact);
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Coerce a raw sex string to the domain {@link Sex}; anything else defaults to `"ALL"`. */
function parseSex(raw: string | undefined): Sex {
  const upper = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return upper === "FEMALE" || upper === "MALE" ? (upper as Sex) : "ALL";
}

/** Build the domain {@link Eligibility} from the raw eligibility module. Total. */
function buildEligibility(module: CtgEligibilityModule | undefined): Eligibility {
  const m = module ?? {};
  return {
    minAgeYears: parseAge(m.minimumAge),
    maxAgeYears: parseAge(m.maximumAge),
    sex: parseSex(m.sex),
    healthyVolunteers: m.healthyVolunteers === true,
    criteriaText: typeof m.eligibilityCriteria === "string" ? m.eligibilityCriteria : "",
  };
}

// ---------------------------------------------------------------------------
// Slim / detail / rank
// ---------------------------------------------------------------------------

/** Shared view into a raw study's protocol modules, with safe defaults. */
function studyParts(rawStudy: CtgStudy) {
  const p = rawStudy.protocolSection ?? {};
  const locations = p.contactsLocationsModule?.locations;
  return {
    nctId: p.identificationModule?.nctId ?? "",
    title: p.identificationModule?.briefTitle ?? "",
    conditions: p.conditionsModule?.conditions ?? [],
    phase: parsePhase(p.designModule?.phases),
    briefSummary: p.descriptionModule?.briefSummary ?? "",
    eligibility: p.eligibilityModule,
    centralContacts: p.contactsLocationsModule?.centralContacts,
    locations,
    sites: recruitingMaSites(locations),
  };
}

/**
 * Slim a raw study to a {@link TrialSummary} (Requirement 4.2). Corrects + filters sites
 * via {@link recruitingMaSites}; returns `null` when no qualifying MA site remains
 * (Requirement 1.3, so the route drops the trial). Otherwise picks {@link nearestSite} and
 * computes `distanceMi` in miles from `origin` (0 when `origin` is absent). Total.
 */
export function slimStudy(
  rawStudy: CtgStudy,
  origin?: { lat: number; lon: number },
): TrialSummary | null {
  const parts = studyParts(rawStudy);
  if (parts.sites.length === 0) return null;
  const nearest = nearestSite(parts.sites, origin);
  const distanceMi = origin
    ? haversineMi(origin.lat, origin.lon, nearest.lat, nearest.lon)
    : 0;
  return {
    nctId: parts.nctId,
    title: parts.title,
    conditions: parts.conditions,
    phase: parts.phase,
    nearestSite: nearest,
    distanceMi,
  };
}

/**
 * Build a full {@link TrialDetail} from a raw study (Requirement 2). Includes the
 * {@link TrialSummary} fields plus briefSummary, eligibility, all qualifying corrected MA
 * sites, contacts, and `stops: []` (Requirement 2.4 — the getting-there spec fills stops).
 *
 * When `origin` is absent, `distanceMi` is 0 and `nearestSite` is the first qualifying
 * corrected site (Requirement 2.3). When no qualifying MA site exists, `sites` is `[]`,
 * `distanceMi` is 0, and `nearestSite` is a defensive city-centroid placeholder so the
 * contract stays satisfiable (the UI tolerates this via lib/data.ts). Total.
 */
export function toDetail(
  rawStudy: CtgStudy,
  origin?: { lat: number; lon: number },
): TrialDetail {
  const parts = studyParts(rawStudy);
  const hasSites = parts.sites.length > 0;
  const nearest: Site = hasSites
    ? nearestSite(parts.sites, origin)
    : // No qualifying MA site: defensive placeholder keeping TrialDetail satisfiable.
      { name: "", city: "", lat: 0, lon: 0, locationPrecision: "city" };
  const distanceMi = origin && hasSites
    ? haversineMi(origin.lat, origin.lon, nearest.lat, nearest.lon)
    : 0;
  return {
    nctId: parts.nctId,
    title: parts.title,
    conditions: parts.conditions,
    phase: parts.phase,
    nearestSite: nearest,
    distanceMi,
    briefSummary: parts.briefSummary,
    eligibility: buildEligibility(parts.eligibility),
    sites: parts.sites,
    contacts: buildContacts(parts.centralContacts, parts.locations),
    stops: [],
  };
}

/**
 * Keep only trials whose nearest-site `distanceMi` is a finite number within `radiusMi`
 * (the normalized requested radius). ClinicalTrials.gov's `filter.geo` matches at the
 * STUDY level, so a study can come back even when its only qualifying recruiting MA site —
 * after {@link correctSite} coordinate correction and {@link nearestSite} selection — sits
 * outside the advertised radius. This closes that gap so results honor the UI's promise.
 *
 * Boundary: the comparison is `<= radiusMi`, so a site exactly on the boundary is kept.
 * Guard: non-finite distances (`NaN`/`Infinity`) are dropped — a missing/garbage geoPoint
 * must never slip through a numeric comparison. Returns a COPY; does not sort. Total.
 */
export function withinRadius(trials: TrialSummary[], radiusMi: number): TrialSummary[] {
  return trials.filter(
    (trial) => Number.isFinite(trial.distanceMi) && trial.distanceMi <= radiusMi,
  );
}

/**
 * Return a sorted COPY of `trials`, ascending by `distanceMi` (Requirement 4.3). Stable for
 * ties via an index tiebreaker so equal-distance trials keep their input order. Total.
 */
export function rankBySiteDistance(trials: TrialSummary[]): TrialSummary[] {
  return trials
    .map((trial, index) => ({ trial, index }))
    .sort((a, b) => a.trial.distanceMi - b.trial.distanceMi || a.index - b.index)
    .map((entry) => entry.trial);
}
