// POST /api/simplify — plain-language, multilingual "might this fit me?" payload
// (spec: simplify). I/O boundary only: validate the request, load the study through the
// SAME upstream cache the detail route uses, then delegate all Bedrock work to
// lib/bedrock.ts. On any Bedrock failure it returns a safe {error} body (503) so the
// frontend falls back to its structured quick-check — it NEVER fabricates a summary.
//
// BOUNDED TOTAL REQUEST BUDGET (Task 1): the whole operation is bounded by
// SERVER_TOTAL_BUDGET_MS = STUDY_LOAD_BUDGET_MS (study load) + BEDROCK_TOTAL_BUDGET_MS
// (all Bedrock work: English primary+retry+fallback, then translate primary+retry+
// fallback). The study load is bounded here; the Bedrock budget is enforced inside
// generateSimplified via a single shared deadline. The server therefore ALWAYS responds
// within the budget with a validated body or a safe error — it never hangs. The CLIENT
// abort/timeout must be >= SERVER_TOTAL_BUDGET_MS (see CLIENT_TIMEOUT_FLOOR_MS in
// lib/bedrock.ts and the INTEGRATION REQUIREMENT) so the client never gives up first.
//
// Body: { nct: string (NCTxxxxxxxx), lang: "en"|"es"|"pt"|"ht"|"zh"|"vi" }.
import { NextResponse } from "next/server";
import type { ApiError, CtgStudiesResponse } from "../../../lib/api-types";
import { cachedFetchJson } from "../../../lib/cache";
import { buildDetailUrl, toDetail } from "../../../lib/clinicaltrials";
import {
  BEDROCK_TOTAL_BUDGET_MS,
  STUDY_LOAD_BUDGET_MS,
  type SimplifyBody,
  generateSimplified,
  getSimplifyCached,
  makeConverse,
  parseLang,
  parseNct,
  setSimplifyCached,
} from "../../../lib/bedrock";

/**
 * How long to wait on ClinicalTrials.gov before giving up. This is the study-load phase
 * of the total request budget (STUDY_LOAD_BUDGET_MS), kept intentionally tight so the
 * remaining budget is reserved for the Bedrock work and the whole request stays bounded.
 */
const UPSTREAM_TIMEOUT_MS = STUDY_LOAD_BUDGET_MS;

class UpstreamTimeoutError extends Error {}

function errorResponse(message: string, status: number): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: message }, { status });
}

/** Network fetcher passed to cachedFetchJson — the only place that touches the upstream. */
async function fetchStudies(url: string): Promise<CtgStudiesResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`upstream responded ${res.status}`);
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

// One shared Converse function per server process (lazy SDK client inside).
const converse = makeConverse();

export async function POST(request: Request): Promise<NextResponse> {
  // 1) Parse + validate the request body (Requirement 1).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("request body must be JSON", 400);
  }
  if (typeof body !== "object" || body === null) {
    return errorResponse("request body must be a JSON object", 400);
  }
  const { nct: rawNct, lang: rawLang } = body as Record<string, unknown>;
  const nct = parseNct(rawNct);
  if (!nct) return errorResponse("nct must look like NCT01234567", 400);
  const lang = parseLang(rawLang);
  if (!lang) return errorResponse("lang must be one of en, es, pt, ht, zh, vi", 400);

  // 2) Serve a cached (nct, lang) result without touching the upstream or Bedrock.
  const cached = getSimplifyCached(nct, lang);
  if (cached) return NextResponse.json<SimplifyBody>(cached);

  // 3) Load the study through the shared upstream cache (Requirement 2), bounded by the
  //    study-load phase of the total request budget.
  let upstream: CtgStudiesResponse;
  try {
    upstream = await cachedFetchJson(nct, () => fetchStudies(buildDetailUrl(nct)));
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) return errorResponse("upstream request timed out", 504);
    return errorResponse("failed to reach ClinicalTrials.gov", 502);
  }
  const studies = Array.isArray(upstream.studies) ? upstream.studies : [];
  if (studies.length === 0) return errorResponse(`no study found for ${nct}`, 404);
  const detail = toDetail(studies[0]);

  // 4) Generate (English-first) + translate via Bedrock (Requirements 7, 8), bounded by
  //    the Bedrock phase of the total budget via a single shared deadline. generateSimplified
  //    always resolves within budgetMs with a validated body or a safe error.
  const result = await generateSimplified({
    detail,
    lang,
    converse,
    budgetMs: BEDROCK_TOTAL_BUDGET_MS,
  });
  if (!result.ok) {
    // Safe, frontend-compatible failure — never a fabricated summary (Requirement 8.3).
    return errorResponse("plain-language summary is unavailable right now", 503);
  }

  // 5) Cache ONLY the successful, validated result (Requirement 9).
  setSimplifyCached(nct, lang, result.body);
  return NextResponse.json<SimplifyBody>(result.body);
}
