// GET /api/trials — the trial-search route handler (spec: trial-search-api, Task 7).
//
// This is the I/O layer: it does ALL fetching and clock reads, and delegates every
// parse/correct/rank decision to the pure helpers in lib/clinicaltrials.ts
// (structure.md: pure logic in lib/, I/O in routes). Flow per Requirement 1:
//
//   validate lat/lon (400, no upstream call if bad)
//     → normalizeRadius → buildSearchUrl
//     → cachedFetchJson (10-min cache, keyed by the upstream URL)
//     → slimStudy(origin) per study → drop nulls → withinRadius → rankBySiteDistance
//     → { trials, total } JSON.
//
// The withinRadius step enforces the advertised radius against the CORRECTED nearest-site
// distance. Upstream `filter.geo` only matches at the study level, so a study can return
// even when its only recruiting MA site lands outside the requested radius after facility
// coordinate correction; we drop those and base `total` on the retained count.
//
// Upstream failure maps to 502 (bad gateway / non-OK response or network error) or 504
// (timeout). cachedFetchJson already serves a fresh-enough cache entry without hitting
// the network and falls back to any cached entry when the fetcher throws, so the catch
// here only runs when there is nothing cached to serve.

import { NextResponse } from "next/server";
import type { ApiError, CtgStudiesResponse, TrialsResponse } from "../../../lib/api-types";
import { cachedFetchJson } from "../../../lib/cache";
import {
  buildSearchUrl,
  normalizeRadius,
  rankBySiteDistance,
  slimStudy,
  withinRadius,
} from "../../../lib/clinicaltrials";
import { toEnglishCondition } from "../../../lib/condition-terms";

/** How long to wait on the upstream before giving up with a 504. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** Sentinel so the catch block can tell a timeout (504) from any other failure (502). */
class UpstreamTimeoutError extends Error {}

/**
 * Parse a query-string coordinate to a finite number, or `null` when it is missing,
 * empty, or non-numeric. An empty string is NOT a valid coordinate (Requirement 1.7),
 * so we reject it explicitly rather than letting `Number("")` coerce to 0.
 */
function parseCoord(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Build a JSON `ApiError` response with the given status. */
function errorResponse(message: string, status: number): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: message }, { status });
}

/**
 * Fetch the upstream search URL and parse its JSON body. Throws an
 * {@link UpstreamTimeoutError} on timeout/abort (→ 504) and a plain `Error` on a non-OK
 * response or any other network failure (→ 502). This is the only place that touches the
 * network; it is passed to {@link cachedFetchJson} as the fetcher.
 */
async function fetchStudies(url: string): Promise<CtgStudiesResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`upstream responded ${res.status}`);
    }
    return (await res.json()) as CtgStudiesResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new UpstreamTimeoutError("upstream request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  // Validate the location first. If lat/lon is missing or non-numeric we return 400 and
  // make NO upstream call (Requirement 1.7). cond may be empty — that is a location-only
  // search (Requirement 1.8), not an error.
  const lat = parseCoord(searchParams.get("lat"));
  const lon = parseCoord(searchParams.get("lon"));
  if (lat === null || lon === null) {
    return errorResponse("lat and lon are required and must be numeric", 400);
  }

  // ClinicalTrials.gov only matches English condition terms, so map common es/pt/ht names
  // ("asma", "presión alta", "tansyon wo") first; unknown or English input is unchanged.
  const cond = toEnglishCondition(searchParams.get("cond") ?? "");
  const radius = normalizeRadius(searchParams.get("radius"));
  const origin = { lat, lon };

  const url = buildSearchUrl({ cond, lat, lon, radius });

  let body: CtgStudiesResponse;
  try {
    // cachedFetchJson serves a fresh (<10 min) entry without calling fetchStudies, caches
    // successful results, and falls back to any cached entry if fetchStudies throws —
    // only rethrowing when nothing is cached (Requirement 6.2, 6.4).
    body = await cachedFetchJson(url, () => fetchStudies(url));
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      return errorResponse("upstream request timed out", 504);
    }
    return errorResponse("failed to reach ClinicalTrials.gov", 502);
  }

  const studies = Array.isArray(body.studies) ? body.studies : [];
  // Slim each study to its nearest corrected MA site, drop studies with no qualifying site,
  // then drop any whose corrected nearest site falls outside the requested radius before
  // ranking. `radius` is already normalized (>= MIN_RADIUS_MI) above, so the enforced bound
  // matches the one sent upstream. `total` reflects the retained, in-radius count.
  const trials = rankBySiteDistance(
    withinRadius(
      studies
        .map((study) => slimStudy(study, origin))
        .filter((summary) => summary !== null),
      radius,
    ),
  );

  const payload: TrialsResponse = { trials, total: trials.length };
  return NextResponse.json<TrialsResponse>(payload);
}
