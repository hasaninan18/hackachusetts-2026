import Link from "next/link";
import { formatMiles } from "@/lib/geo";
import { format } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import type { Lang, TrialSummary } from "@/lib/types";

export function TrialListItem({
  trial,
  lang,
  dict,
  from,
  mock,
}: {
  trial: TrialSummary;
  lang: Lang;
  dict: Dictionary;
  from: { lat: number; lon: number };
  mock: boolean;
}) {
  const href = `/${lang}/trial/${encodeURIComponent(trial.nctId)}?from=${from.lat},${from.lon}${mock ? "&mock=1" : ""}`;
  return (
    <li className="border-b border-line">
      <Link href={href} className="block min-h-11 py-4 text-ink no-underline hover:bg-card">
        {trial.conditions.length > 0 && (
          <span lang="en" className="block text-sm text-muted">
            {trial.conditions.slice(0, 2).join(" · ")}
          </span>
        )}
        <span
          lang={lang === "en" ? undefined : "en"}
          className="mt-1 block text-lg font-semibold leading-snug"
        >
          {trial.title}
        </span>
        {trial.phase && (
          <span className="mt-1 block text-sm text-muted">
            {dict["results.phase"]}: {trial.phase.replace(/^Phase\s*/i, "")}
          </span>
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
