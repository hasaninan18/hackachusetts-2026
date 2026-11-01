// Nightly ClinicalTrials.gov → database rows (docs/NATIONAL_PLAN.md §2).
//
// PURE: URL building and study → row mapping only. The runner (scripts/snapshot-us.ts, and
// later a cron route) does the fetching. Sites go through the same recruitingSites /
// correctSite / buildContacts rules as the live search, so the database and the current
// per-request path can never disagree about which sites count.

import type { CtgStudiesResponse, CtgStudy } from "../api-types";
import { buildContacts, parsePhase, recruitingSites } from "../clinicaltrials";
import { REGIONS, type Region, US_STATES } from "../region";
import type { Contact, Site } from "../types";

const CTG_BASE = "https://clinicaltrials.gov/api/v2/studies";

/** ClinicalTrials.gov's page-size ceiling; the whole US recruiting set is ~23 pages. */
export const MAX_PAGE_SIZE = 1000;

/** Everything the database needs; a superset of the live search's field list. */
export const INGEST_FIELDS = [
  "NCTId",
  "BriefTitle",
  "Condition",
  "Keyword",
  "ConditionBrowseModule",
  "Phase",
  "BriefSummary",
  "EligibilityModule",
  "LeadSponsorName",
  "LastUpdatePostDate",
  "LocationFacility",
  "LocationCity",
  "LocationState",
  "LocationZip",
  "LocationCountry",
  "LocationGeoPoint",
  "LocationStatus",
  "LocationContactName",
  "LocationContactPhone",
  "LocationContactEMail",
  "CentralContactName",
  "CentralContactPhone",
  "CentralContactEMail",
] as const;

/** Upstream fields the live search does not request; typed here, not in api-types.ts. */
export interface IngestStudy extends CtgStudy {
  protocolSection?: CtgStudy["protocolSection"] & {
    conditionsModule?: { conditions?: string[]; keywords?: string[] };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    statusModule?: { lastUpdatePostDateStruct?: { date?: string } };
  };
  derivedSection?: {
    conditionBrowseModule?: {
      meshes?: { term?: string }[];
      ancestors?: { term?: string }[];
    };
  };
}

export interface IngestPage extends CtgStudiesResponse {
  studies?: IngestStudy[];
  nextPageToken?: string;
}

/**
 * One page of every RECRUITING study with a US location. `since` (YYYY-MM-DD) limits it to
 * studies updated on or after that date, for the nightly update of changes.
 */
export function buildUsPageUrl({
  pageToken,
  pageSize = MAX_PAGE_SIZE,
  since,
}: { pageToken?: string; pageSize?: number; since?: string } = {}): string {
  const params = new URLSearchParams();
  params.set("query.locn", 'AREA[LocationCountry]"United States"');
  params.set("filter.overallStatus", "RECRUITING");
  if (since !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`since must be YYYY-MM-DD: ${since}`);
    params.set("filter.advanced", `AREA[LastUpdatePostDate]RANGE[${since},MAX]`);
  }
  params.set("pageSize", String(Math.min(Math.max(1, Math.trunc(pageSize)), MAX_PAGE_SIZE)));
  params.set("fields", INGEST_FIELDS.join(","));
  if (pageToken === undefined) params.set("countTotal", "true");
  else params.set("pageToken", pageToken);
  return `${CTG_BASE}?${params.toString()}`;
}

/** A `trials` table row (db/schema.sql). */
export interface TrialRow {
  nctId: string;
  title: string;
  conditions: string[];
  /**
   * Extra search terms: the study's keywords plus its MeSH condition terms and their
   * ancestors (e.g. "Diabetes Mellitus, Type 2" → "Diabetes Mellitus", "Metabolic
   * Diseases"), so a database search finds what ClinicalTrials.gov's synonym search did.
   */
  terms: string[];
  phase: string | null;
  briefSummary: string;
  eligibility: NonNullable<CtgStudy["protocolSection"]>["eligibilityModule"] | null;
  sponsor: string | null;
  lastUpdate: string | null;
  contacts: Contact[];
}

/** A `sites` table row: one recruiting US location, coordinates already corrected. */
export interface SiteRow extends Site {
  nctId: string;
  /** Position among the study's qualifying sites; with nctId, the primary key. */
  ordinal: number;
  state: string;
}

const STATE_CODE_BY_NAME = new Map(
  Object.entries(US_STATES).map(([code, name]) => [name as string, code]),
);

/** Keywords + MeSH terms + MeSH ancestors, trimmed and de-duplicated case-insensitively. */
function searchTerms(study: IngestStudy): string[] {
  const browse = study.derivedSection?.conditionBrowseModule;
  const raw = [
    ...(study.protocolSection?.conditionsModule?.keywords ?? []),
    ...(browse?.meshes ?? []).map((m) => m.term),
    ...(browse?.ancestors ?? []).map((m) => m.term),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of raw) {
    const t = typeof term === "string" ? term.trim() : "";
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/** ZIP → centroid, e.g. backed by public/zcta/. Returns null for an unknown ZIP. */
export type ZipCentroid = (zip: string) => { lat: number; lon: number } | null;

function hasGeoPoint(loc: { geoPoint?: { lat?: number; lon?: number } }): boolean {
  return Number.isFinite(loc.geoPoint?.lat) && Number.isFinite(loc.geoPoint?.lon);
}

/**
 * Map one raw study to its trial row and its recruiting in-region site rows. Returns `null`
 * for a study with no NCT ID or no qualifying site (it would never show in search).
 *
 * A site without a geoPoint is placed at its ZIP centroid (precision "zip") when `zipCentroid`
 * knows the ZIP, and dropped otherwise — never at correctCoordinates' Boston fallback, which
 * only makes sense for MA. Total.
 */
export function toRows(
  study: IngestStudy,
  region: Region = REGIONS.us,
  zipCentroid: ZipCentroid = () => null,
): { trial: TrialRow; sites: SiteRow[]; droppedNoLocation: number } | null {
  const p = study.protocolSection ?? {};
  const nctId = p.identificationModule?.nctId ?? "";
  if (!/^NCT\d{8}$/.test(nctId)) return null;

  const locations = p.contactsLocationsModule?.locations ?? [];
  const sites: SiteRow[] = [];
  let droppedNoLocation = 0;
  // recruitingSites drops the state, so map one raw location at a time to keep it.
  for (const loc of locations) {
    const [site] = recruitingSites([loc], region);
    if (!site) continue;
    let placed: Site = site;
    if (!hasGeoPoint(loc)) {
      const centroid = loc.zip ? zipCentroid(loc.zip.slice(0, 5)) : null;
      if (!centroid) {
        droppedNoLocation++;
        continue;
      }
      placed = { ...site, lat: centroid.lat, lon: centroid.lon, locationPrecision: "zip" };
    }
    sites.push({
      ...placed,
      nctId,
      ordinal: sites.length,
      state: STATE_CODE_BY_NAME.get(loc.state ?? "") ?? "",
    });
  }
  if (sites.length === 0) return null;

  return {
    trial: {
      nctId,
      title: p.identificationModule?.briefTitle ?? "",
      conditions: p.conditionsModule?.conditions ?? [],
      terms: searchTerms(study),
      phase: parsePhase(p.designModule?.phases),
      briefSummary: p.descriptionModule?.briefSummary ?? "",
      eligibility: p.eligibilityModule ?? null,
      sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? null,
      lastUpdate: p.statusModule?.lastUpdatePostDateStruct?.date ?? null,
      contacts: buildContacts(p.contactsLocationsModule?.centralContacts, locations, region),
    },
    sites,
    droppedNoLocation,
  };
}
