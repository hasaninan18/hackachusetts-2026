// Contract + browser helper for POST /api/translate-titles — SDK-FREE on purpose.
//
// The results page (a "use client" list) imports THIS module, never lib/translate-titles.ts,
// because that one pulls lib/bedrock.ts and the AWS SDK. Everything here is plain data, a
// pure response parser, and a fetch wrapper with an injectable `fetch`, so tests never touch
// the network.
//
// Privacy (safety.md §3): the request carries ONLY registry text — NCT id, title, and
// condition labels. No health answers, location, or search words are ever sent.
import { PER_CALL_TIMEOUT_MS } from "./simplify-budget";
import type { Lang } from "./types";

/** Target languages. English is the source, so it is never a target (the route 400s on it). */
export const TITLE_LANGS = ["es", "pt", "ht", "zh", "vi"] as const;
export type TitleLang = (typeof TITLE_LANGS)[number];
export function isTitleLang(value: unknown): value is TitleLang {
  return typeof value === "string" && (TITLE_LANGS as readonly string[]).includes(value);
}
export function wantsTitleTranslation(lang: Lang): lang is TitleLang {
  return isTitleLang(lang);
}

/** Request limits (enforced by the route; the client stays inside them). */
export const MAX_TITLE_ITEMS = 25;
export const MAX_TITLE_CHARS = 500;
export const MAX_CONDITIONS = 10;
export const MAX_CONDITION_CHARS = 200;
/**
 * Items per request the results page sends. Smaller than the 25 maximum so each single
 * Converse call has a short output and finishes well inside its 8 s ceiling; batches run in
 * parallel and swap in as each one lands.
 */
export const CLIENT_BATCH_SIZE = 10;
/** The list only shows the first two condition labels, so only those are translated. */
export const CONDITIONS_SHOWN = 2;

/** Each Converse call is bounded like the simplify pipeline (about 8 s). */
export const TITLES_PER_CALL_TIMEOUT_MS = PER_CALL_TIMEOUT_MS;
/** First call + one retry. */
export const TITLES_MAX_ATTEMPTS = 2;
/** Shared deadline for all Bedrock work in one request (two bounded calls). */
export const TITLES_SERVER_BUDGET_MS = TITLES_PER_CALL_TIMEOUT_MS * TITLES_MAX_ATTEMPTS; // 16000
/** The browser waits a little longer than the server so it sees the server's answer. */
export const TITLES_CLIENT_TIMEOUT_MS = TITLES_SERVER_BUDGET_MS + 2000; // 18000

export interface TitleItem {
  nctId: string;
  title: string;
  conditions: string[];
}
export interface TitlesRequestBody {
  lang: TitleLang;
  items: TitleItem[];
}
export interface TitlesResponseBody {
  lang: TitleLang;
  items: TitleItem[];
}
export interface TitleTranslation {
  title: string;
  conditions: string[];
}
/** Translations keyed by NCT id. A missing id means "show English". */
export type TitleTranslations = ReadonlyMap<string, TitleTranslation>;

/** Build the request item for one trial: only registry text, only what the list shows. */
export function toTitleItem(trial: { nctId: string; title: string; conditions: string[] }): TitleItem {
  return {
    nctId: trial.nctId,
    title: trial.title,
    conditions: trial.conditions.slice(0, CONDITIONS_SHOWN),
  };
}

export function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Parse a /api/translate-titles body in the browser. Keeps only items whose id was asked
 * for, whose title is a non-empty string, and whose conditions line up one-to-one with
 * what was sent. Anything else is ignored (that trial stays English). Never throws.
 */
export function parseTitlesResponse(
  data: unknown,
  lang: TitleLang,
  requested: readonly TitleItem[],
): Map<string, TitleTranslation> | null {
  if (typeof data !== "object" || data === null) return null;
  const body = data as Record<string, unknown>;
  if (body.lang !== lang || !Array.isArray(body.items)) return null;
  const byId = new Map(requested.map((r) => [r.nctId, r]));
  const out = new Map<string, TitleTranslation>();
  for (const raw of body.items) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const source = typeof item.nctId === "string" ? byId.get(item.nctId) : undefined;
    if (!source || out.has(source.nctId)) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) continue;
    if (!Array.isArray(item.conditions) || item.conditions.length !== source.conditions.length) continue;
    const conditions = item.conditions.map((c) => (typeof c === "string" ? c.trim() : ""));
    if (conditions.some((c) => !c)) continue;
    out.set(source.nctId, { title, conditions });
  }
  return out;
}

export interface RequestTitlesOptions {
  lang: TitleLang;
  items: readonly TitleItem[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Aborts the request (e.g. the list unmounted or the language changed). */
  signal?: AbortSignal;
}

/**
 * POST one batch to /api/translate-titles. Resolves to the parsed translations, or `null`
 * on any failure (HTTP error, network error, bad body, timeout, abort). NEVER rejects, so a
 * caller can fire it and forget it while the English list is already on screen.
 */
export function requestTitleTranslations(opts: RequestTitlesOptions): Promise<Map<string, TitleTranslation> | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TITLES_CLIENT_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal?.aborted) return Promise.resolve(null);
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Settles even if the fetch implementation ignores the abort signal.
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const body: TitlesRequestBody = {
    lang: opts.lang,
    // Rebuild each item so nothing but the three registry fields can ride along.
    items: opts.items.map((i) => ({ nctId: i.nctId, title: i.title, conditions: [...i.conditions] })),
  };
  const call = (async () => {
    try {
      const res = await fetchImpl("/api/translate-titles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return parseTitlesResponse(await res.json(), opts.lang, opts.items);
    } catch {
      return null;
    }
  })();
  return Promise.race([call, timedOut]).finally(() => {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  });
}

export interface StartTitlesOptions {
  lang: TitleLang;
  items: readonly TitleItem[];
  signal: AbortSignal;
  /** Called with every translation so far, each time a batch lands with at least one. */
  onUpdate: (translations: Map<string, TitleTranslation>) => void;
  request?: typeof requestTitleTranslations;
  batchSize?: number;
}

/**
 * Fire-and-forget: send the items in parallel batches and report translations as each batch
 * lands. Returns immediately (it never awaits), so the English list is never held up. A
 * failed or late batch just leaves its studies in English; nothing is reported after abort.
 */
export function startTitleTranslations(opts: StartTitlesOptions): void {
  const request = opts.request ?? requestTitleTranslations;
  const found = new Map<string, TitleTranslation>();
  for (const batch of chunk(opts.items, opts.batchSize ?? CLIENT_BATCH_SIZE)) {
    void request({ lang: opts.lang, items: batch, signal: opts.signal }).then((result) => {
      if (opts.signal.aborted || !result || result.size === 0) return;
      for (const [id, value] of result) found.set(id, value);
      opts.onUpdate(new Map(found));
    });
  }
}
