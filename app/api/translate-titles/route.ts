// POST /api/translate-titles — translate the study titles and condition labels shown on
// the results page. I/O boundary only: validate the request, serve what the (nctId, lang)
// cache already has, and make ONE bounded Bedrock Converse call for the rest (one retry on
// failure or invalid JSON). All parsing and validation live in lib/translate-titles.ts.
//
// Body: { lang: "es"|"pt"|"ht"|"zh"|"vi", items: [{ nctId, title, conditions: string[] }] }
// (1–25 items). English is the source, so lang "en" is a 400.
//
// 200 { lang, items } holds ONLY the items that passed validation, in request order; any
// study left out shows in English. 503 { error } when nothing could be translated. The
// page renders the English list first and never waits on this route.
//
// Privacy (safety.md §3): only registry text is accepted (unknown fields are a 400) and
// nothing from the request is logged.
import { NextResponse } from "next/server";
import type { ApiError } from "../../../lib/api-types";
import { makeConverse } from "../../../lib/bedrock";
import {
  TITLES_MAX_TOKENS,
  getCachedTitle,
  parseTitlesRequest,
  setCachedTitle,
  translateTitles,
} from "../../../lib/translate-titles";
import type {
  TitleItem,
  TitleTranslation,
  TitlesResponseBody,
} from "../../../lib/translate-titles-client";

function errorResponse(message: string, status: number): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: message }, { status });
}

// One shared Converse function per server process (lazy SDK client inside).
const converse = makeConverse(undefined, { maxTokens: TITLES_MAX_TOKENS });

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("request body must be JSON", 400);
  }
  const parsed = parseTitlesRequest(body);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const { lang, items } = parsed.value;

  const translated = new Map<string, TitleTranslation>();
  const missing: TitleItem[] = [];
  for (const item of items) {
    const hit = getCachedTitle(lang, item);
    if (hit) translated.set(item.nctId, hit);
    else missing.push(item);
  }

  if (missing.length > 0) {
    const result = await translateTitles({ lang, items: missing, converse });
    if (result.ok) {
      const byId = new Map(missing.map((m) => [m.nctId, m]));
      for (const item of result.items) {
        const source = byId.get(item.nctId);
        if (!source) continue;
        const value = { title: item.title, conditions: item.conditions };
        setCachedTitle(lang, source, value);
        translated.set(item.nctId, value);
      }
    } else if (translated.size === 0) {
      return errorResponse("translated study names are unavailable right now", 503);
    }
  }

  const out: TitlesResponseBody = {
    lang,
    items: items.flatMap((i) => {
      const t = translated.get(i.nctId);
      return t ? [{ nctId: i.nctId, title: t.title, conditions: t.conditions }] : [];
    }),
  };
  return NextResponse.json<TitlesResponseBody>(out);
}
