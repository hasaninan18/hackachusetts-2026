// The trial page's server-side translation: ask the simplify service for the study's
// translated title + summary BEFORE rendering, so non-English pages never flash English
// text first. Bounded by the existing simplify budget (SERVER_TOTAL_BUDGET_MS); on a
// timeout or any failure it resolves null and the page renders today's English fallback.
// Never rejects.
import { waitUntil } from "@vercel/functions";
import { SERVER_TOTAL_BUDGET_MS } from "./simplify-budget";
import { parseSimplified } from "./simplify";
import { simplifyTrial } from "./simplify-service";
import type { Lang, Simplified } from "./types";

export interface AutoTranslation {
  /** Study title in the page language. */
  title: string;
  /** The same shape the client fetch produces (lib/simplify.ts#parseSimplified). */
  simplified: Simplified;
}

export async function loadAutoTranslation(
  nct: string,
  lang: Lang,
  timeFallback: string,
  { timeoutMs = SERVER_TOTAL_BUDGET_MS }: { timeoutMs?: number } = {},
): Promise<AutoTranslation | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const work = simplifyTrial(nct, lang)
    .then((result): AutoTranslation | null => {
      if (!result.ok) return null;
      const simplified = parseSimplified(result.body, lang, timeFallback);
      const title = typeof result.body.title === "string" ? result.body.title.trim() : "";
      if (!simplified || simplified.lang !== lang || !title) return null;
      return { title, simplified };
    })
    .catch(() => null);
  // If the page stops waiting, keep the function alive until the work finishes so its
  // result still lands in the shared cache for the next visitor. No-op off Vercel.
  waitUntil(work);
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
