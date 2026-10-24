import Link from "next/link";
import { formatMiles } from "@/lib/geo";
import { format } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import type { Lang, TrialSummary } from "@/lib/types";

export function TrialListItem({
  trial,
  lang,
  dict,
  search,
  mock,
}: {
  trial: TrialSummary;
  lang: Lang;
  dict: Dictionary;
  search: { cond: string; lat: number; lon: number; radius: number };
  mock: boolean;
}) {
  const qs = new URLSearchParams({
    cond: search.cond,
    lat: String(search.lat),
    lon: String(search.lon),
    radius: String(search.radius),
  });
  if (mock) qs.set("mock", "1");
  const href = `/${lang}/trial/${encodeURIComponent(trial.nctId)}?${qs}`;
  return (
    <li className="border-b border-line">
      <Link href={href} className="block min-h-11 py-4 text-ink no-underline hover:bg-card">
        {trial.conditions.length > 0 && (
          <span lang="en" className="block text-sm text-muted">
            {trial.conditions.slice(0, 2).join(" · ")}
          </span>
        )}
        <h2
          lang={lang === "en" ? undefined : "en"}
          className="mt-1 text-lg font-semibold leading-snug"
        >
          {trial.title}
        </h2>
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
