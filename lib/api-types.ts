// API response + raw upstream types for TrialPath MA (spec: trial-search-api).
//
// Route handlers and tests import response types from here so there's one place for the
// API contract. The DOMAIN types are owned by Neil's lib/types.ts — we import and
// re-export them, never redefine them.
//
// The raw ClinicalTrials.gov v2 shapes below cover ONLY the `fields` the search requests:
// NCTId, BriefTitle, Condition, Phase, BriefSummary, EligibilityModule, LocationFacility,
// LocationCity, LocationState, LocationGeoPoint, LocationStatus,
// LocationContactName, LocationContactPhone, LocationContactEMail,
// CentralContactName, CentralContactPhone, CentralContactEMail.

import type { TrialDetail, TrialSummary, TrialsResponse } from "./types";

// Response contracts live in lib/types.ts; re-exported here for one-stop imports.
export type { TrialDetail, TrialSummary, TrialsResponse };

/** JSON error body returned by the /api/trials* route handlers. */
export interface ApiError {
  error: string;
}

// ---------------------------------------------------------------------------
// Raw ClinicalTrials.gov API v2 shapes (https://clinicaltrials.gov/api/v2/studies).
// Everything is optional: the upstream omits empty fields, and lib/clinicaltrials.ts
// is responsible for defaulting/validating before building our domain types.
// ---------------------------------------------------------------------------

export interface CtgGeoPoint {
  lat: number;
  lon: number;
}

export interface CtgLocation {
  facility?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Per-site recruitment status; filter to "RECRUITING" (BACKEND_NOTES.md §2). */
  status?: string;
  geoPoint?: CtgGeoPoint;
  /**
   * Site-level contacts (LocationContactName/Phone/EMail). Used by buildContacts as the
   * fallback when the study has no central contact.
   */
  contacts?: CtgContact[];
}

export interface CtgContact {
  name?: string;
  phone?: string;
  email?: string;
  /** e.g. "CONTACT" | "PRINCIPAL_INVESTIGATOR". */
  role?: string;
}

export interface CtgEligibilityModule {
  eligibilityCriteria?: string;
  /** "ALL" | "FEMALE" | "MALE". */
  sex?: string;
  /** e.g. "18 Years", "6 Months", "N/A". */
  minimumAge?: string;
  maximumAge?: string;
  healthyVolunteers?: boolean;
}

export interface CtgStudy {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
    };
    conditionsModule?: {
      conditions?: string[];
    };
    designModule?: {
      /** e.g. ["PHASE1","PHASE2"] or ["NA"]. */
      phases?: string[];
    };
    descriptionModule?: {
      briefSummary?: string;
    };
    eligibilityModule?: CtgEligibilityModule;
    contactsLocationsModule?: {
      locations?: CtgLocation[];
      centralContacts?: CtgContact[];
    };
  };
}

export interface CtgStudiesResponse {
  studies?: CtgStudy[];
  totalCount?: number;
}
