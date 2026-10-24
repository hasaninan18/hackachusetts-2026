// POST /api/simplify — plain-language, multilingual "might this fit me?" payload
// (spec: simplify). I/O boundary only: validate the request, then delegate to
// lib/simplify-service.ts, which the trial page's server component also uses, so both read
// the same shared cache (keyed by nctId, lang and criteria-revision hash).
//
// The summary is separate from the checklist: any valid study gets a translated title,
// summary, whatYouDo and timeCommitment. When the server-built checklist cannot be made
// (unsupported study or language, criteria revised, too few questions) the body has
// `questions: []` and a `checklistReason`; the UI then shows its cautious "Not sure yet"
// state. On a Bedrock failure it still returns a safe {error} body (503); it never
// fabricates a summary.
//
// BOUNDED: the service caps the study load at STUDY_LOAD_BUDGET_MS and all Bedrock work at
// BEDROCK_TOTAL_BUDGET_MS, so this route always answers within SERVER_TOTAL_BUDGET_MS. The
// client timeout (CLIENT_TIMEOUT_FLOOR_MS) is set above that.
//
// Body: { nct: string (NCTxxxxxxxx), lang: "en"|"es"|"pt"|"ht"|"zh"|"vi" }.
import { NextResponse } from "next/server";
import type { ApiError } from "../../../lib/api-types";
import { parseLang, parseNct } from "../../../lib/bedrock";
import type { TrialSimplifyBody } from "../../../lib/simplify-auto";
import { simplifyTrial } from "../../../lib/simplify-service";

function errorResponse(message: string, status: number): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: message }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1) Parse + validate the request body.
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

  // 2) Cached result, or load the study and generate (bounded; never throws).
  const result = await simplifyTrial(nct, lang);
  if (!result.ok) {
    // Safe, frontend-compatible failure: never a fabricated summary.
    const message =
      result.status === 503 ? "plain-language summary is unavailable right now" : result.error;
    return errorResponse(message, result.status);
  }
  return NextResponse.json<TrialSimplifyBody>(result.body);
}
