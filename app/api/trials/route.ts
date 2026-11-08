// GET /api/trials — the trial-search route handler (spec: trial-search-api, Task 7).
//
// This is the I/O layer: it does ALL fetching and clock reads, and delegates every
// parse/correct/rank decision to the pure helpers in lib/clinicaltrials.ts
// (structure.md: pure logic in lib/, I/O in routes). Flow per Requirement 1:
//
//   validate lat/lon (400, no upstream call if bad)
//     → normalizeRadius
//     → [database configured (lib/db/client.ts)] searchTrialsWithTotal → { trials, total } JSON
//       (total = every in-radius match, trials = the nearest RESULT_LIMIT),
//       or on any database error continue below
//     → buildSearchUrl
//     → cachedFetchJson (10-min cache, keyed by the first-page upstream URL)
//       → runLiveSearch: fetch every page by following `nextPageToken` (at most
//         LIVE_MAX_PAGES, one UPSTREAM_TIMEOUT_MS deadline for all of them), folding each
//         page into createSearchSummary as it arrives (dedupe → slimStudy(origin) → drop
//         nulls → withinRadius), then rankBySiteDistance → nearest RESULT_LIMIT
//     → { trials, total[, truncated] } JSON.
//
// The withinRadius step enforces the advertised radius against the CORRECTED nearest-site
// distance. Upstream `filter.geo` only matches at the study level, so a study can return
// even when its only recruiting MA site lands outside the requested radius after facility
// coordinate correction; we drop those and base `total` on the retained count.
//
// The cache holds the finished response, not the raw pages: a large search is tens of MB of
// raw JSON, while the response is at most RESULT_LIMIT slim trials. The key still identifies
// the search exactly (cond, origin and radius are all in the URL; the region is per build).
//
// Upstream failure maps to 502 (bad gateway / non-OK response or network error) or 504
// (timeout). Any failing page fails the whole search: a partial list would silently miss
// trials. cachedFetchJson already serves a fresh-enough cache entry without hitting
// the network and falls back to any cached entry when the fetcher throws, so the catch
// here only runs when there is nothing cached to serve.

import { NextResponse } from "next/server";
import type {
  ApiError,
  CtgStudiesResponse,
  TrialsResponse,
} from "../../../lib/api-types";
import { cachedFetchJson } from "../../../lib/cache";
import {
  buildSearchUrl,
  LIVE_MAX_PAGES,
  createSearchSummary,
  normalizeRadius,
  RESULT_LIMIT,
} from "../../../lib/clinicaltrials";
import { toEnglishCondition } from "../../../lib/condition-terms";
import { getDb } from "../../../lib/db/client";
import { searchTrialsWithTotal } from "../../../lib/db/trials";
import { ACTIVE_REGION } from "../../../lib/region";

/** Most trials one database search returns (the live path returns the same number). */
const DB_RESULT_LIMIT = RESULT_LIMIT;

/** How long to wait on the upstream, for ALL pages together, before giving up with a 504. */
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

/** One search, as the pieces {@link buildSearchUrl} needs for each page. */
type LiveSearch = { cond: string; lat: number; lon: number; radius: number };

/**
 * Fetch one upstream page and parse its JSON body. Throws a plain `Error` on a non-OK
 * response; an abort or network failure propagates for {@link runLiveSearch} to map.
 */
async function fetchPage(url: string, signal: AbortSignal): Promise<CtgStudiesResponse> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`upstream responded ${res.status}`);
  }
  return (await res.json()) as CtgStudiesResponse;
}

/**
 * Run a live search page by page, following `nextPageToken`, up to {@link LIVE_MAX_PAGES}
 * pages, and return the finished response. Each page is folded into a
 * {@link createSearchSummary} as soon as it arrives and then dropped, so memory peaks at about
 * one page of raw JSON instead of every page at once.
 *
 * One deadline ({@link UPSTREAM_TIMEOUT_MS}) covers all pages, so a slow multi-page search
 * still ends with a 504 on time. Throws an {@link UpstreamTimeoutError} on timeout/abort
 * (→ 504) and a plain `Error` on a non-OK response or any other network failure (→ 502); a
 * failing page fails the whole search. The search stops early when upstream offers no token
 * or a token it already gave (an A→B→A loop is not "more results"); it is `truncated` only
 * when the page cap stops it with a new token still offered. This is the only place that
 * touches the network; it is passed to {@link cachedFetchJson} as the fetcher.
 */
async function runLiveSearch(
  search: LiveSearch,
  origin: { lat: number; lon: number },
): Promise<TrialsResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const summary = createSearchSummary(origin, search.radius);
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < LIVE_MAX_PAGES; page++) {
      const body = await fetchPage(buildSearchUrl({ ...search, pageToken }), controller.signal);
      if (Array.isArray(body.studies)) summary.add(body.studies);
      const next = body.nextPageToken;
      if (typeof next !== "string" || next === "" || seenTokens.has(next)) {
        return summary.finish();
      }
      seenTokens.add(next);
      pageToken = next;
    }
    console.warn(
      `[trials] live search stopped at ${LIVE_MAX_PAGES} upstream pages with more left; total is a lower bound`,
    );
    return summary.finish({ truncated: true });
  } catch (err) {
    if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
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

  // National database path (docs/NATIONAL_PLAN.md §2), only when one is configured. It has
  // no 50-study cap and filters sites to the build's region. Any database failure falls
  // through to the live ClinicalTrials.gov path below rather than failing the search.
  const db = await getDb();
  if (db) {
    try {
      // `total` counts every in-radius match; `trials` is the nearest DB_RESULT_LIMIT of them,
      // the same contract as the live path below.
      const { trials, total } = await searchTrialsWithTotal(db, {
        lat,
        lon,
        radiusMi: radius,
        cond,
        states: ACTIVE_REGION.states,
        limit: DB_RESULT_LIMIT,
      });
      return NextResponse.json<TrialsResponse>({ trials, total });
    } catch (err) {
      console.error("[db] search failed; falling back to ClinicalTrials.gov", err);
    }
  }

  const search: LiveSearch = { cond, lat, lon, radius };
  const url = buildSearchUrl(search);

  let payload: TrialsResponse;
  try {
    // cachedFetchJson serves a fresh (<10 min) entry without fetching, caches successful
    // results, and falls back to any cached entry if the fetch throws — only rethrowing
    // when nothing is cached (Requirement 6.2, 6.4).
    // shareInFlight: identical concurrent cold searches share one paging run. Every caller
    // of this key is this route, with the same deadline and error mapping.
    payload = await cachedFetchJson(url, () => runLiveSearch(search, origin), Date.now(), {
      shareInFlight: true,
    });
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      return errorResponse("upstream request timed out", 504);
    }
    return errorResponse("failed to reach ClinicalTrials.gov", 502);
  }

  // `radius` is already normalized (5–MAX_RADIUS_MI) above, so the radius createSearchSummary
  // enforces matches the one sent upstream. `total` counts every in-radius trial found;
  // `trials` is the nearest RESULT_LIMIT of them.
  return NextResponse.json<TrialsResponse>(payload);
}
