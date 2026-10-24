// GET /api/trials/[nct] — the single-trial detail route handler (spec: trial-search-api, Task 8).
//
// Sibling of app/api/trials/route.ts (the search handler) and shares its I/O shape: this is
// the I/O layer — it does ALL fetching and clock reads and delegates every parse/correct
// decision to the pure helpers in lib/clinicaltrials.ts (structure.md: pure logic in lib/,
// I/O in routes). Flow per Requirement 2:
//
//   read optional lat/lon (NOT required here — unlike search)
//     → buildDetailUrl(nct)
//     → cachedFetchJson (10-min cache, keyed by the NCT ID)
//     → 404 ApiError when the upstream returns no study
//     → toDetail(study, origin?) — distanceMi 0 + first corrected site when no origin
//     → TrialDetail JSON (stops: []).
//
// Upstream failure maps to 502 (bad gateway / non-OK response or network error) or 504
// (timeout). cachedFetchJson serves a fresh-enough cache entry without hitting the network
// and falls back to any cached entry when the fetcher throws, so the catch here only runs
// when there is nothing cached to serve (Requirement 6.4).

import { NextResponse } from "next/server";
import type { ApiError, CtgStudiesResponse, TrialDetail } from "../../../../lib/api-types";
import { cachedFetchJson } from "../../../../lib/cache";
import { buildDetailUrl, toDetail } from "../../../../lib/clinicaltrials";

/** How long to wait on the upstream before giving up with a 504. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** Sentinel so the catch block can tell a timeout (504) from any other failure (502). */
class UpstreamTimeoutError extends Error {}

/**
 * Parse a query-string coordinate to a finite number, or `null` when it is missing,
 * empty, or non-numeric. An empty string is NOT a valid coordinate, so we reject it
 * explicitly rather than letting `Number("")` coerce to 0. Unlike the search route,
 * missing/invalid coordinates are NOT an error here — they just mean "no origin"
 * (Requirement 2.3).
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
 * Fetch the upstream detail URL and parse its JSON body. Throws an
 * {@link UpstreamTimeoutError} on timeout/abort (→ 504) and a plain `Error` on a non-OK
 * response or any other network failure (→ 502). This is the only place that touches the
 * network; it is passed to {@link cachedFetchJson} as the fetcher. Mirrors the search
 * route's fetcher so a reader sees one pattern across both handlers.
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ nct: string }> },
): Promise<NextResponse> {
  const { nct } = await params;
  const { searchParams } = new URL(request.url);

  // lat/lon are OPTIONAL here (Requirement 2.3): when both are present and numeric they
  // form the origin for distance/nearest-site; otherwise we pass NO origin to toDetail,
  // which then sets distanceMi = 0 and nearestSite = first qualifying corrected site. We do
  // NOT 400 on missing/non-numeric coordinates, unlike the search route.
  const lat = parseCoord(searchParams.get("lat"));
  const lon = parseCoord(searchParams.get("lon"));
  const origin = lat !== null && lon !== null ? { lat, lon } : undefined;

  // buildDetailUrl uses query.id, so the response comes back in the same { studies: [...] }
  // shape as search. The cache is keyed by the NCT ID (Requirement 6.1).
  const url = buildDetailUrl(nct);

  let body: CtgStudiesResponse;
  try {
    // cachedFetchJson serves a fresh (<10 min) entry without calling fetchStudies, caches
    // successful results, and falls back to any cached entry if fetchStudies throws —
    // only rethrowing when nothing is cached (Requirement 6.2, 6.4).
    body = await cachedFetchJson(nct, () => fetchStudies(url));
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      return errorResponse("upstream request timed out", 504);
    }
    return errorResponse("failed to reach ClinicalTrials.gov", 502);
  }

  const studies = Array.isArray(body.studies) ? body.studies : [];
  if (studies.length === 0) {
    return errorResponse(`no study found for ${nct}`, 404);
  }

  const detail = toDetail(studies[0], origin);
  return NextResponse.json<TrialDetail>(detail);
}
