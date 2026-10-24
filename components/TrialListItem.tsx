import Link from "next/link";
// Relative (like FitResult.tsx) so the runtime imports also resolve under Vitest, which has
// no "@/" alias; the other imports here are type-only.
import { formatMiles } from "../lib/geo";
import { HTML_LANG, format } from "../lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import type { TitleTranslation } from "@/lib/translate-titles-client";
import type { Lang, TrialSummary } from "@/lib/types";

export function TrialListItem({
  trial,
  lang,
  dict,
  search,
  mock,
  translation,
}: {
  trial: TrialSummary;
  lang: Lang;
  dict: Dictionary;
  search: { cond: string; lat: number; lon: number; radius: number };
  mock: boolean;
  /** Machine translation of the title + first conditions; absent means show English. */
  translation?: TitleTranslation;
}) {
  const qs = new URLSearchParams({
    cond: search.cond,
    lat: String(search.lat),
    lon: String(search.lon),
    radius: String(search.radius),
  });
  if (mock) qs.set("mock", "1");
  const href = `/${lang}/trial/${encodeURIComponent(trial.nctId)}?${qs}`;
  const conditions = translation ? translation.conditions : trial.conditions.slice(0, 2);
  // English registry text is tagged lang="en" so screen readers switch voice for it.
  const englishLang = lang === "en" ? undefined : "en";
  return (
    <li className="border-b border-line">
      <Link href={href} className="block min-h-11 py-4 text-ink no-underline hover:bg-card">
        {conditions.length > 0 && (
          <span lang={translation ? undefined : englishLang} className="block text-sm text-muted">
            {conditions.join(" · ")}
          </span>
        )}
        <h2 lang={translation ? undefined : englishLang} className="mt-1 text-lg font-semibold leading-snug">
          {translation ? translation.title : trial.title}
        </h2>
        {translation && (
          <>
            <span lang="en" className="mt-1 block text-sm text-muted">
              <span lang={HTML_LANG[lang]} className="sr-only">
                {dict["results.originalTitle"]}{" "}
              </span>
              {trial.title}
            </span>
            <span className="mt-1 inline-block rounded border border-line px-1.5 text-xs font-medium text-muted">
              {dict["results.machineTranslated"]}
            </span>
          </>
        )}
        <span className="mt-1 block text-sm text-muted">
          {trial.nearestSite.name}, {trial.nearestSite.city}
        </span>
        <span className="mt-1 block text-sm font-semibold text-primary">
          {format(dict["results.away"], { mi: formatMiles(trial.distanceMi) })}
        </span>
      </Link>
    </li>
  );
}
