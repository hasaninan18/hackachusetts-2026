import { LANGS, type FitQuestion, type Lang, type Simplified } from "./types";

// Parses a POST /api/simplify response. Accepts the lib/types.ts shape and the shape in
// docs/TASKS.md ({ summary, whatYouDo, questions: [{ id, text, rulesOut }] }, no timeCommitment),
// so the card works whichever one the backend ships. Anything else returns null and the page
// falls back to the official summary.
export function parseSimplified(value: unknown, requestedLang: Lang, timeFallback: string): Simplified | null {
  if (typeof value !== "object" || value === null) return null;
  const s = value as Record<string, unknown>;

  const whatItStudies = text(s.whatItStudies) ?? text(s.summary);
  const whatYouDo = text(s.whatYouDo);
  if (!whatItStudies || !whatYouDo || !Array.isArray(s.questions)) return null;

  const questions: FitQuestion[] = [];
  for (const raw of s.questions) {
    if (typeof raw !== "object" || raw === null) return null;
    const q = raw as Record<string, unknown>;
    const rule = q.ruleOutIf ?? q.rulesOut;
    const id = typeof q.id === "number" ? String(q.id) : text(q.id);
    const qText = text(q.text);
    if (!id || !qText || (rule !== "yes" && rule !== "no")) return null;
    questions.push({ id, text: qText, ruleOutIf: rule });
  }
  if (new Set(questions.map((q) => q.id)).size !== questions.length) return null;

  const lang = (LANGS as readonly unknown[]).includes(s.lang) ? (s.lang as Lang) : requestedLang;
  return {
    lang,
    whatItStudies,
    whatYouDo,
    timeCommitment: text(s.timeCommitment) ?? timeFallback,
    questions,
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
