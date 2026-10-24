"use client";

import { useEffect, useMemo, useState } from "react";
// Relative so the runtime imports also resolve under Vitest (no "@/" alias there).
import { translator } from "../lib/i18n";
import {
  startTitleTranslations,
  toTitleItem,
  wantsTitleTranslation,
  type TitleItem,
  type TitleTranslation,
  type TitleTranslations,
} from "../lib/translate-titles-client";
import type { Dictionary } from "@/lib/i18n";
import type { Lang, TrialSummary } from "@/lib/types";
import { TrialListItem } from "./TrialListItem";

const NONE: TitleTranslations = new Map();

function requestKey(lang: Lang, items: readonly TitleItem[]): string {
  return `${lang}|${items.map((i) => i.nctId).join(",")}`;
}

/** The "names are in English" note stays while any study on the list is still in English. */
export function englishNoteVisible(
  lang: Lang,
  trials: readonly TrialSummary[],
  translations: TitleTranslations,
): boolean {
  return lang !== "en" && trials.some((t) => !translations.has(t.nctId));
}

// Renders the English list straight away (this is also the server HTML), then, for es/pt/
// ht/zh/vi, asks /api/translate-titles in the background and swaps translations in as they
// arrive. Only registry text (NCT id, title, conditions) is sent. If a request fails or
// times out the list simply stays in English with the existing note. Mock mode never calls
// the API.
export function ResultsList({
  trials,
  lang,
  dict,
  search,
  mock,
}: {
  trials: TrialSummary[];
  lang: Lang;
  dict: Dictionary;
  search: { cond: string; lat: number; lon: number; radius: number };
  mock: boolean;
}) {
  const t = translator(dict);
  const items = useMemo(() => trials.map(toTitleItem), [trials]);
  const key = requestKey(lang, items);
  // Results remember which list + language they belong to, so a language switch never
  // shows the previous language's titles.
  const [result, setResult] = useState<{ key: string; translations: Map<string, TitleTranslation> } | null>(null);
  const translations: TitleTranslations =
    !mock && result && result.key === key ? result.translations : NONE;

  useEffect(() => {
    if (mock || items.length === 0 || !wantsTitleTranslation(lang)) return;
    const forKey = requestKey(lang, items);
    const controller = new AbortController();
    startTitleTranslations({
      lang,
      items,
      signal: controller.signal,
      onUpdate: (found) => setResult({ key: forKey, translations: found }),
    });
    return () => controller.abort();
  }, [lang, mock, items]);

  return (
    <>
      {englishNoteVisible(lang, trials, translations) && (
        <p className="mt-1 text-sm text-muted">{t("results.englishNote")}</p>
      )}
      <ol className="mt-4 border-t border-line">
        {trials.map((trial) => (
          <TrialListItem
            key={trial.nctId}
            trial={trial}
            lang={lang}
            dict={dict}
            search={search}
            mock={mock}
            translation={translations.get(trial.nctId)}
          />
        ))}
      </ol>
    </>
  );
}
