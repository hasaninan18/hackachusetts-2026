import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TrialListItem } from "@/components/TrialListItem";
import { getTrials, wantsMocks } from "@/lib/data";
import { getDictionary, isLang, translator } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import type { Lang, TrialsResponse } from "@/lib/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const RADII = [5, 10, 25];

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function ResultsSkeleton({ loading }: { loading: string }) {
  return (
    <div>
      <p role="status" className="sr-only">
        {loading}
      </p>
      <div aria-hidden="true" className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-28 w-full" />
        ))}
      </div>
    </div>
  );
}

const buttonClass =
  "inline-flex min-h-12 items-center rounded-md bg-primary px-6 font-semibold text-white no-underline hover:bg-primary-hover";

async function Results({
  lang,
  dict,
  searchParams,
}: {
  lang: Lang;
  dict: Dictionary;
  searchParams: SearchParams;
}) {
  const t = translator(dict);
  const sp = await searchParams;
  const cond = first(sp.cond).trim();
  const latRaw = first(sp.lat);
  const lonRaw = first(sp.lon);
  const lat = latRaw === "" ? NaN : Number(latRaw);
  const lon = lonRaw === "" ? NaN : Number(lonRaw);
  const radiusNum = Number(first(sp.radius));
  const radius = RADII.includes(radiusNum) ? radiusNum : 10;
  const mock = wantsMocks(sp.mock);

  if (!cond || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return (
      <p>
        <Link href={`/${lang}`} className="font-semibold text-primary underline">
          {t("nav.newSearch")}
        </Link>
      </p>
    );
  }

  const baseParams = new URLSearchParams({
    cond,
    lat: String(lat),
    lon: String(lon),
    radius: String(radius),
  });
  if (mock) baseParams.set("mock", "1");

  let data: TrialsResponse | null = null;
  try {
    data = await getTrials({ cond, lat, lon, radius }, mock);
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <div role="alert">
        <p>{t("results.error")}</p>
        <p className="mt-3">
          <a href={`/${lang}/results?${baseParams}`} className={buttonClass}>
            {t("results.retry")}
          </a>
        </p>
      </div>
    );
  }

  if (data.trials.length === 0) {
    const wider = new URLSearchParams(baseParams);
    wider.set("radius", "25");
    return (
      <div>
        <h2 className="text-lg font-semibold">{t("results.emptyTitle", { mi: radius })}</h2>
        <p className="mt-2 text-muted">{t("results.emptyBody")}</p>
        <p className="mt-4 flex flex-wrap items-center gap-4">
          {radius !== 25 && (
            <Link href={`/${lang}/results?${wider}`} className={buttonClass}>
              {t("results.tryWider")}
            </Link>
          )}
          <Link
            href={`/${lang}${mock ? "?mock=1" : ""}`}
            className="inline-flex min-h-12 items-center font-semibold text-primary underline"
          >
            {t("nav.newSearch")}
          </Link>
        </p>
      </div>
    );
  }

  const n = data.trials.length;
  return (
    <div>
      <p role="status" className="font-semibold">
        {n === 1 ? t("results.countOne", { mi: radius }) : t("results.count", { n, mi: radius })}
      </p>
      {lang !== "en" && <p className="mt-1 text-sm text-muted">{t("results.englishNote")}</p>}
      <ol className="mt-4 border-t border-line">
        {data.trials.map((trial) => (
          <TrialListItem
            key={trial.nctId}
            trial={trial}
            lang={lang}
            dict={dict}
            from={{ lat, lon }}
            mock={mock}
          />
        ))}
      </ol>
    </div>
  );
}

export default async function ResultsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/results">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const dict = getDictionary(lang);
  const t = translator(dict);

  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight text-ink">{t("results.heading")}</h1>
      <div className="mt-4">
        <Suspense fallback={<ResultsSkeleton loading={t("results.loading")} />}>
          <Results lang={lang} dict={dict} searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
