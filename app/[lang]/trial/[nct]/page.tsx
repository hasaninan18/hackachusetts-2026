import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { ContactCard } from "@/components/ContactCard";
import { GettingThere } from "@/components/GettingThere";
import { TrialPlain } from "@/components/TrialPlain";
import { getTrial, wantsMocks } from "@/lib/data";
import { getDictionary, isLang, translator } from "@/lib/i18n";
import type { TrialDetail } from "@/lib/types";

const NCT_RE = /^NCT\d{8}$/;

type Props = PageProps<"/[lang]/trial/[nct]">;

// [nct] has no generateStaticParams, so params (and searchParams) are request-time data under
// Cache Components and must be read inside <Suspense>. The skeleton is the static shell.
export default function TrialPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<TrialSkeleton />}>
      <Trial params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Trial({ params, searchParams }: Props) {
  const { lang, nct } = await params;
  if (!isLang(lang)) notFound();
  if (!NCT_RE.test(nct)) notFound();

  const sp = await searchParams;
  const mock = wantsMocks(sp.mock);
  const origin = parseOrigin(sp.from);
  const dict = getDictionary(lang);
  const t = translator(dict);
  const homeHref = mock ? `/${lang}?mock=1` : `/${lang}`;

  let trial: TrialDetail | null;
  try {
    trial = await getTrial(nct, mock);
  } catch (err) {
    unstable_rethrow(err);
    console.error(err);
    const retry = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
        retry.append(key, v);
      }
    }
    const query = retry.toString();
    return (
      <div>
        <p role="alert" className="text-lg text-ink">
          {t("results.error")}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={`/${lang}/trial/${nct}${query ? `?${query}` : ""}`}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-5 text-base font-medium text-white hover:bg-primary-hover"
          >
            {t("results.retry")}
          </a>
          <Link
            href={homeHref}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-card px-5 text-base font-medium text-ink"
          >
            {t("nav.newSearch")}
          </Link>
        </div>
      </div>
    );
  }
  if (!trial) notFound();

  // Trial facts come from ClinicalTrials.gov in English; mark them so screen readers switch voice.
  const enLang = lang !== "en" ? "en" : undefined;
  const site = trial.nearestSite;

  return (
    <article>
      <Link
        href={homeHref}
        className="no-print inline-flex min-h-11 items-center text-base font-medium text-primary underline"
      >
        {t("nav.newSearch")}
      </Link>

      <p className="print-only mt-2 text-sm text-muted">{t("print.heading")}</p>
      <h1 className="mt-3 text-2xl font-bold leading-tight text-ink" lang={enLang}>
        {trial.title}
      </h1>
      <p className="mt-1 text-muted">{trial.nctId}</p>

      <div className="mt-4">
        <p className="text-sm font-medium text-muted">{t("trial.where")}</p>
        <p className="text-ink">
          <span lang={enLang}>{site.name}</span>, {site.city}
        </p>
        {site.locationPrecision !== "facility" && (
          <p className="mt-1 text-sm text-muted">{t("trial.approxLocation")}</p>
        )}
      </div>

      <TrialPlain
        nctId={trial.nctId}
        lang={lang}
        mock={mock}
        briefSummary={trial.briefSummary}
        eligibility={trial.eligibility}
        dict={dict}
      />

      <GettingThere site={site} stops={trial.stops} origin={origin} t={t} />

      <ContactCard
        nctId={trial.nctId}
        contacts={trial.contacts}
        t={t}
        printLabel={t("contact.print")}
      />

      <p className="mt-6 border-t border-line pt-6">
        <a
          href={`https://clinicaltrials.gov/study/${trial.nctId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-base font-medium text-primary underline"
        >
          {t("trial.official")}
        </a>
      </p>
    </article>
  );
}

// `from=lat,lon` is the user's search location, used as the transit-directions origin.
function parseOrigin(from: string | string[] | undefined): { lat: number; lon: number } | undefined {
  if (typeof from !== "string") return undefined;
  const parts = from.split(",");
  if (parts.length !== 2 || parts.some((p) => p.trim() === "")) return undefined;
  const [lat, lon] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

function TrialSkeleton() {
  return (
    <div aria-busy="true" aria-hidden="true">
      <div className="skeleton h-5 w-28" />
      <div className="skeleton mt-4 h-8 w-full" />
      <div className="skeleton mt-2 h-8 w-2/3" />
      <div className="skeleton mt-3 h-4 w-32" />
      <div className="skeleton mt-5 h-4 w-1/2" />
      <div className="mt-6 space-y-2 border-t border-line pt-6">
        <div className="skeleton h-6 w-1/2" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-11/12" />
        <div className="skeleton h-4 w-3/4" />
      </div>
    </div>
  );
}
