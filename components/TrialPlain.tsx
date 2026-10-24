"use client";

import { useEffect, useState } from "react";
import { translator } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n/en";
import { getMockSimplified } from "@/lib/mock/simplified";
import type { Eligibility, FitQuestion, Lang, Simplified } from "@/lib/types";
import { LANGS } from "@/lib/types";
import { PlainCard } from "./PlainCard";
import { QuickCheck } from "./QuickCheck";

export type SimplifyState =
  | { status: "loading" }
  | { status: "ready"; data: Simplified }
  | { status: "failed" };

const TIMEOUT_MS = 10_000; // docs/FRONTEND_PLAN.md §12
const MOCK_DELAY_MS = 400; // long enough to see the loading state

// Fetches the plain-language version once per trial + language, then feeds PlainCard and
// QuickCheck. Only { nctId, lang } is ever sent; quick-check answers stay in this component tree.
export function TrialPlain({
  nctId,
  lang,
  mock,
  briefSummary,
  eligibility,
  dict,
}: {
  nctId: string;
  lang: Lang;
  mock: boolean;
  briefSummary: string;
  eligibility: Eligibility;
  dict: Dictionary;
}) {
  const t = translator(dict);
  const requestKey = `${nctId}:${lang}`;
  // The result remembers which request it answers, so a language switch (same component,
  // new props) shows the loading state again instead of the previous language's text.
  const [result, setResult] = useState<{ key: string; state: SimplifyState } | null>(null);
  const state: SimplifyState =
    result && result.key === requestKey ? result.state : { status: "loading" };

  useEffect(() => {
    let ignore = false;
    const key = `${nctId}:${lang}`;
    const settle = (next: SimplifyState) => {
      if (!ignore) setResult({ key, state: next });
    };

    if (mock) {
      const timer = setTimeout(() => {
        const data = getMockSimplified(nctId, lang);
        settle(data ? { status: "ready", data } : { status: "failed" });
      }, MOCK_DELAY_MS);
      return () => {
        ignore = true;
        clearTimeout(timer);
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    fetch("/api/simplify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nctId, lang }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`POST /api/simplify ${res.status}`);
        const data: unknown = await res.json();
        settle(isSimplified(data) ? { status: "ready", data } : { status: "failed" });
      })
      .catch(() => settle({ status: "failed" }))
      .finally(() => clearTimeout(timer));

    return () => {
      ignore = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [nctId, lang, mock]);

  const questions = state.status === "ready" ? state.data.questions : [];
  const questionsLang = state.status === "ready" ? state.data.lang : lang;

  return (
    <>
      <PlainCard state={state} lang={lang} briefSummary={briefSummary} t={t} />
      {/* Keyed by request so answers never carry over to a different set of questions. */}
      <QuickCheck
        key={requestKey}
        lang={lang}
        status={state.status}
        questions={questions}
        questionsLang={questionsLang}
        eligibility={eligibility}
        t={t}
      />
    </>
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isQuestion(value: unknown): value is FitQuestion {
  if (typeof value !== "object" || value === null) return false;
  const q = value as Record<string, unknown>;
  return isNonEmptyString(q.id) && isNonEmptyString(q.text) && (q.ruleOutIf === "yes" || q.ruleOutIf === "no");
}

// Minimal shape check. Anything unexpected counts as a failure, so the page falls back to the
// official summary instead of showing partial or rule-out-less questions.
function isSimplified(value: unknown): value is Simplified {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (
    !(LANGS as readonly unknown[]).includes(s.lang) ||
    !isNonEmptyString(s.whatItStudies) ||
    !isNonEmptyString(s.whatYouDo) ||
    !isNonEmptyString(s.timeCommitment) ||
    !Array.isArray(s.questions) ||
    !s.questions.every(isQuestion)
  ) {
    return false;
  }
  const ids = new Set(s.questions.map((q: FitQuestion) => q.id));
  return ids.size === s.questions.length;
}
