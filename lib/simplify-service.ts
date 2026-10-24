// Server-side simplify service: load the study, serve the shared cache, or generate a
// translated title + plain-language summary with Bedrock. Used by POST /api/simplify AND by
// the trial page's server component, so both see the same cached result.
//
// I/O lives here (upstream fetch, cache, Bedrock via an injected `converse`); every
// decision is delegated to pure helpers in lib/simplify-auto.ts and lib/bedrock.ts.
//
// The shared cache holds ONLY generated text (title + prose), keyed by (nctId, lang,
// criteria-revision hash). The checklist is rebuilt from the live registry on every
// response, so a cached entry can never carry questions past a registry or mapping change.
//
// Bounded: the study load is capped at STUDY_LOAD_BUDGET_MS and all Bedrock work shares
// one BEDROCK_TOTAL_BUDGET_MS deadline, so the whole call resolves within
// SERVER_TOTAL_BUDGET_MS (plus cache I/O) with a validated body or a safe error. It never
// rejects.
import type { CtgStudiesResponse } from "./api-types";
import {
  BEDROCK_TOTAL_BUDGET_MS,
  MIN_CALL_MS,
  PER_CALL_TIMEOUT_MS,
  STUDY_LOAD_BUDGET_MS,
  assembleModel,
  buildEnglishProsePrompt,
  checkProseTranslationInvariants,
  extractProtectedValues,
  makeConverse,
  toResponseBody,
  validateProseOutput,
  type Converse,
  type Prompt,
} from "./bedrock";
import type { SimplifyProse } from "./bedrock-types";
import { cachedFetchJson } from "./cache";
import { buildDetailUrl, toDetail } from "./clinicaltrials";
import { SHARED_CACHE_TTL_SECONDS, sharedCache, type SharedCache } from "./shared-cache";
import {
  KEEP_EXACT_RULE,
  buildTitleAndProseTranslatePrompt,
  isValidCachedTranslation,
  parseTranslatedTitle,
  resolveChecklist,
  sourceHash,
  validateEnglishFields,
  validateTranslatedFields,
  type CachedTranslation,
  type ChecklistOutcome,
  type TrialSimplifyBody,
} from "./simplify-auto";
import { criteriaRevisionHash } from "./simplify-mappings";
import type { Lang, TrialDetail } from "./types";

// ---------------------------------------------------------------------------
// Cache key: (nctId, lang, criteria-revision hash)
// ---------------------------------------------------------------------------
export function simplifyCacheKey(nct: string, lang: Lang, criteriaHash: string): string {
  return `simplify:v2:${nct}:${lang}:${criteriaHash}`;
}

// ---------------------------------------------------------------------------
// Generation (Bedrock via injected converse)
// ---------------------------------------------------------------------------
export interface GenerateTrialDeps {
  detail: TrialDetail;
  lang: Lang;
  converse: Converse;
  /** Validated English prose from the cache; skips the English Bedrock call. */
  englishBase?: SimplifyProse;
  /** Precomputed checklist (the service builds it once per response). */
  checklist?: ChecklistOutcome;
  primaryModel?: string;
  fallbackModel?: string;
  timeoutMs?: number;
  budgetMs?: number;
  now?: () => number;
  warn?: (msg: string) => void;
}

export type GenerateTrialResult =
  | {
      ok: true;
      body: TrialSimplifyBody;
      /** The requested language's title + prose (what the cache stores). */
      title: string;
      prose: SimplifyProse;
      /** The English prose it was written or translated from. */
      englishProse: SimplifyProse;
    }
  | { ok: false; error: string };

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

interface Deadline {
  remaining(): number;
}
function makeDeadline(budgetMs: number, now: () => number): Deadline {
  const end = now() + budgetMs;
  return { remaining: () => Math.max(0, end - now()) };
}

async function converseBounded(
  converse: Converse,
  modelId: string,
  prompt: Prompt,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await converse(modelId, prompt, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One call plus ONE retry. The retry stays on the primary model when the output failed
 * validation, and moves to the fallback model when the call itself failed (error/timeout).
 * Both attempts share the request deadline.
 */
async function callWithOneRetry<T>(
  deps: GenerateTrialDeps,
  deadline: Deadline,
  prompt: Prompt,
  validate: (raw: string) => Checked<T>,
): Promise<Checked<T>> {
  const primary = deps.primaryModel ?? process.env.BEDROCK_MODEL_ID ?? "us.amazon.nova-2-lite-v1:0";
  const fallback =
    deps.fallbackModel ?? process.env.BEDROCK_FALLBACK_MODEL_ID ?? "us.amazon.nova-pro-v1:0";
  const perCall = deps.timeoutMs ?? PER_CALL_TIMEOUT_MS;
  let lastError = "no attempt made";
  let callFailed = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline.remaining();
    if (left < MIN_CALL_MS) return { ok: false, error: "total request budget exhausted" };
    const modelId = attempt === 1 && callFailed ? fallback : primary;
    try {
      const raw = await converseBounded(deps.converse, modelId, prompt, Math.min(perCall, left));
      callFailed = false;
      const checked = validate(raw);
      if (checked.ok) return checked;
      lastError = checked.error;
    } catch (err) {
      callFailed = true;
      lastError = err instanceof Error ? err.message : "Bedrock call failed";
    }
  }
  return { ok: false, error: lastError };
}

/** Shape the HTTP body: generated title + prose, plus the server-built checklist. */
export function toTrialBody(
  prose: SimplifyProse,
  title: string,
  lang: Lang,
  checklist: ChecklistOutcome,
): TrialSimplifyBody {
  const { summary, whatYouDo, timeCommitment, staff_checks } = prose;
  const body: TrialSimplifyBody = {
    ...toResponseBody(
      assembleModel({ summary, whatYouDo, timeCommitment, staff_checks }, checklist.questions),
      lang,
    ),
    title,
  };
  if (checklist.reason) body.checklistReason = checklist.reason;
  return body;
}

/**
 * English prose first (or the cached copy), then for other languages ONE call that
 * translates the registry title and the prose together. The checklist is resolved
 * separately and never blocks the summary.
 */
export async function generateTrialSimplify(deps: GenerateTrialDeps): Promise<GenerateTrialResult> {
  const { detail, lang } = deps;
  const deadline = makeDeadline(deps.budgetMs ?? BEDROCK_TOTAL_BUDGET_MS, deps.now ?? Date.now);
  const checklist = deps.checklist ?? resolveChecklist(detail, lang, deps.warn);

  const sourceText = [
    detail.nctId,
    detail.title,
    detail.briefSummary,
    detail.eligibility.criteriaText,
    ...detail.contacts.map((c) => [c.name, c.phone, c.email].filter(Boolean).join(" ")),
  ].join("\n");
  const source = extractProtectedValues(sourceText);

  // 1) English prose, written from the registry with the existing summary prompt rules.
  let english = deps.englishBase;
  if (!english) {
    const base = buildEnglishProsePrompt(detail);
    const prompt: Prompt = { system: base.system, user: `${base.user}\n${KEEP_EXACT_RULE}` };
    const generated = await callWithOneRetry(deps, deadline, prompt, (raw) => {
      const v = validateProseOutput(raw, { lang: "en", source });
      if (!v.ok) return v;
      const err = validateEnglishFields(v.value, sourceText);
      return err ? { ok: false, error: err } : v;
    });
    if (!generated.ok) return { ok: false, error: `english generation failed: ${generated.error}` };
    english = generated.value;
  }
  const englishProse = english;

  if (lang === "en") {
    return {
      ok: true,
      body: toTrialBody(englishProse, detail.title, "en", checklist),
      title: detail.title,
      prose: englishProse,
      englishProse,
    };
  }

  // 2) Title + prose translation in one call, validated field by field.
  const original = {
    title: detail.title,
    summary: englishProse.summary,
    whatYouDo: englishProse.whatYouDo,
  };
  const translated = await callWithOneRetry(
    deps,
    deadline,
    buildTitleAndProseTranslatePrompt({ title: detail.title, ...englishProse }, lang),
    (raw): Checked<{ prose: SimplifyProse; title: string }> => {
      const v = validateProseOutput(raw, { lang, source });
      if (!v.ok) return v;
      const invariant = checkProseTranslationInvariants(englishProse, v.value);
      if (invariant) return { ok: false, error: invariant };
      const title = parseTranslatedTitle(raw);
      const err = validateTranslatedFields({ ...v.value, title }, original);
      if (err || !title) return { ok: false, error: err ?? "title is empty" };
      return { ok: true, value: { prose: v.value, title } };
    },
  );
  if (!translated.ok) return { ok: false, error: `translation failed: ${translated.error}` };
  const { prose, title } = translated.value;
  return { ok: true, body: toTrialBody(prose, title, lang, checklist), title, prose, englishProse };
}

// ---------------------------------------------------------------------------
// Study load (same upstream cache as GET /api/trials/[nct])
// ---------------------------------------------------------------------------
class UpstreamTimeoutError extends Error {}

async function fetchStudies(url: string): Promise<CtgStudiesResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STUDY_LOAD_BUDGET_MS);
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

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------
export type SimplifyServiceResult =
  | { ok: true; body: TrialSimplifyBody }
  | { ok: false; status: 404 | 502 | 503 | 504; error: string };

export interface SimplifyServiceDeps {
  converse?: Converse;
  cache?: SharedCache;
  primaryModel?: string;
  fallbackModel?: string;
  timeoutMs?: number;
  budgetMs?: number;
  now?: () => number;
}

// One shared Converse function per server process (lazy SDK client inside).
let defaultConverse: Converse | null = null;

/**
 * `nct` and `lang` must already be validated (parseNct / parseLang). Only successful,
 * validated text is cached; a failure is never cached, so the next request retries.
 */
export async function simplifyTrial(
  nct: string,
  lang: Lang,
  deps: SimplifyServiceDeps = {},
): Promise<SimplifyServiceResult> {
  const cache = deps.cache ?? sharedCache;
  const now = deps.now ?? Date.now;

  let upstream: CtgStudiesResponse;
  try {
    upstream = await cachedFetchJson(nct, () => fetchStudies(buildDetailUrl(nct)));
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      return { ok: false, status: 504, error: "upstream request timed out" };
    }
    return { ok: false, status: 502, error: "failed to reach ClinicalTrials.gov" };
  }
  const studies = Array.isArray(upstream.studies) ? upstream.studies : [];
  if (studies.length === 0) return { ok: false, status: 404, error: `no study found for ${nct}` };
  const detail = toDetail(studies[0]);

  // The checklist comes from the live registry data on every response, never the cache.
  const checklist = resolveChecklist(detail, lang);

  const criteriaHash = criteriaRevisionHash(detail.eligibility.criteriaText ?? "");
  // Each entry records what it was generated from; a mismatch on read is a miss.
  const identity = { nctId: nct, criteriaHash, sourceHash: sourceHash(detail) };
  const ttlMs = SHARED_CACHE_TTL_SECONDS * 1000;
  const read = async (l: Lang): Promise<CachedTranslation | undefined> => {
    const entry = await cache.get<unknown>(simplifyCacheKey(nct, l, criteriaHash));
    return isValidCachedTranslation(entry, { ...identity, lang: l, now: now(), ttlMs })
      ? entry
      : undefined;
  };
  const write = (l: Lang, title: string, prose: SimplifyProse) => {
    const entry: CachedTranslation = { v: 2, ...identity, lang: l, createdAt: now(), title, prose };
    return cache.set(simplifyCacheKey(nct, l, criteriaHash), entry);
  };

  const hit = await read(lang);
  if (hit) return { ok: true, body: toTrialBody(hit.prose, hit.title, lang, checklist) };

  // Another language reuses the cached English prose: one Bedrock call instead of two.
  const englishEntry = lang === "en" ? undefined : await read("en");

  const converse = deps.converse ?? (defaultConverse ??= makeConverse());
  const result = await generateTrialSimplify({
    detail,
    lang,
    converse,
    checklist,
    englishBase: englishEntry?.prose,
    primaryModel: deps.primaryModel,
    fallbackModel: deps.fallbackModel,
    timeoutMs: deps.timeoutMs,
    budgetMs: deps.budgetMs,
    now,
  });
  if (!result.ok) return { ok: false, status: 503, error: result.error };

  const writes: Promise<void>[] = [];
  if (lang !== "en" && !englishEntry) writes.push(write("en", detail.title, result.englishProse));
  writes.push(write(lang, result.title, result.prose));
  await Promise.all(writes);
  return { ok: true, body: result.body };
}
