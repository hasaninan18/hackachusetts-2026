"use client";

import { useEffect, useState } from "react";
import { translator } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n/en";
import { getMockSimplified } from "@/lib/mock/simplified";
import { parseSimplified } from "@/lib/simplify";
import { CLIENT_TIMEOUT_FLOOR_MS } from "../lib/simplify-budget";
import type { Eligibility, Lang, Simplified } from "@/lib/types";
import { PlainCard } from "./PlainCard";
import { QuickCheck } from "./QuickCheck";

export type SimplifyState =
  | { status: "loading" }
  | { status: "ready"; data: Simplified }
  | { status: "failed" };

const TIMEOUT_MS = CLIENT_TIMEOUT_FLOOR_MS;
const MOCK_DELAY_MS = 400; // long enough to see the loading state

// In-memory only (never localStorage/sessionStorage) and only successful results. With Cache
// Components the router keeps this component's state on Back but re-runs its effects, and a
// fresh mount after client navigation starts empty; both reuse the cached copy instead of
// asking the model again. The module starts empty on every full page load, and effects never
// run on the server, so the first client render always matches the server HTML.
const simplifiedCache = new Map<string, Simplified>();

function cacheKey(nctId: string, lang: Lang, mock: boolean): string {
  // Mock content is kept apart so it can never appear on a page showing real data.
  return `${nctId}:${lang}${mock ? ":mock" : ""}`;
}

// Fetches the plain-language version once per trial + language, then feeds PlainCard and
// QuickCheck. Only { nctId, lang } is ever sent; quick-check answers stay in this component tree.
// `initial` is the server's answer for exactly this nctId + lang (non-English pages get it
// before rendering, so there is no English flash). When given, no client request is made.
export function TrialPlain({
  nctId,
  lang,
  mock,
  briefSummary,
  eligibility,
  dict,
  initial,
}: {
  nctId: string;
  lang: Lang;
  mock: boolean;
  briefSummary: string;
  eligibility: Eligibility;
  dict: Dictionary;
  initial?: Exclude<SimplifyState, { status: "loading" }>;
}) {
  const t = translator(dict);
  const timeFallback = dict["trial.timeAsk"];
  const requestKey = cacheKey(nctId, lang, mock);
  // The result remembers which request it answers, so a language switch (same component,
  // new props) shows the loading state again instead of the previous language's text.
  const [result, setResult] = useState<{ key: string; state: SimplifyState } | null>(null);
  const cached = simplifiedCache.get(requestKey);
  const state: SimplifyState = initial
    ? initial
    : cached
      ? { status: "ready", data: cached }
      : result && result.key === requestKey
        ? result.state
        : { status: "loading" };
  const hasInitial = initial !== undefined;

  useEffect(() => {
    if (hasInitial) return; // the server already answered (or gave up) for this request
    const key = cacheKey(nctId, lang, mock);
    if (simplifiedCache.has(key)) return;

    let ignore = false;
    const settle = (next: SimplifyState) => {
      if (ignore) return;
      if (next.status === "ready") simplifiedCache.set(key, next.data);
      // A late failure (timeout, aborted retry) never replaces text the person is reading.
      setResult((prev) =>
        next.status === "failed" &&
        (simplifiedCache.has(key) || (prev?.key === key && prev.state.status === "ready"))
          ? prev
          : { key, state: next },
      );
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
      // `nct` too: docs/TASKS.md names the field that way; lib/types.ts uses nctId.
      body: JSON.stringify({ nctId, nct: nctId, lang }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`POST /api/simplify ${res.status}`);
        const data: unknown = await res.json();
        const parsed = parseSimplified(data, lang, timeFallback);
        settle(parsed ? { status: "ready", data: parsed } : { status: "failed" });
      })
      .catch(() => settle({ status: "failed" }))
      .finally(() => clearTimeout(timer));

    return () => {
      ignore = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [nctId, lang, mock, timeFallback, hasInitial]);

  const questions = state.status === "ready" ? state.data.questions : [];
  const questionsLang = state.status === "ready" ? state.data.lang : lang;

  return (
    <>
      <PlainCard state={state} lang={lang} briefSummary={briefSummary} t={t} />
      {/* A new trial or language starts a fresh quick check. Within one, answers are scoped
          to the exact question set inside QuickCheck, so they can never attach to different
          questions, while age/sex typed during loading are kept. */}
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

