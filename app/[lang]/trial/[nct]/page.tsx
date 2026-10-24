import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { lang as rootLang } from "next/root-params";
import { cache, Suspense } from "react";
import { ContactCard } from "@/components/ContactCard";
import { GettingThere } from "@/components/GettingThere";
import { TrialPlain } from "@/components/TrialPlain";
import { StudyResults } from "@/components/StudyResults";
import { getTrial, wantsMocks } from "@/lib/data";
import { getDictionary, isLang, translator } from "@/lib/i18n";
import type { Eligibility } from "@/lib/types";
import type { TrialDetailWithOutcomes } from "@/lib/outcomes";

const NCT_RE = /^NCT\d{8}$/;
const APP_NAME = "TrialPath MA";

type Props = PageProps<"/[lang]/trial/[nct]">;
type SearchParams = Awaited<Props["searchParams"]>;

// generateMetadata and the page both need the trial; cache() makes it one lookup per request.
const loadTrial = cache((nct: string, mock: boolean) => getTrial(nct, mock));

// Reads params/searchParams, so under Cache Components this runs at request time. That is fine
// here: the page body already defers to request time inside <Suspense>, so the metadata simply
// streams in with it (generate-metadata.md, "With Cache Components").
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { lang, nct } = await params;
  const t = translator(getDictionary(isLang(lang) ? lang : "en"));
  const description = t("meta.description");
  const fallback: Metadata = { title: { absolute: APP_NAME }, description };
  if (!isLang(lang) || !NCT_RE.test(nct)) return fallback;

  const sp = await searchParams;
  try {
    const trial = await loadTrial(nct, wantsMocks(sp.mock));
    if (!trial) return fallback;
    // `absolute` skips the layout's "%s · TrialPath MA" template, which would add the name twice.
    return { title: { absolute: `${trial.title} (${nct}) · ${APP_NAME}` }, description };
  } catch (err) {
    unstable_rethrow(err);
    return fallback;
  }
}

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
  const search = parseSearch(sp);
  // `from=lat,lon` (older links) wins; otherwise the search location is the directions origin.
  const origin = parseOrigin(sp.from) ?? (search ? { lat: search.lat, lon: search.lon } : undefined);
  const dict = getDictionary(lang);
  const t = translator(dict);
  const homeHref = mock ? `/${lang}?mock=1` : `/${lang}`;
  let resultsHref: string | undefined;
  if (search) {
    const qs = new URLSearchParams({
      cond: search.cond,
      lat: search.latRaw,
      lon: search.lonRaw,
      radius: search.radius,
    });
    if (mock) qs.set("mock", "1");
    resultsHref = `/${lang}/results?${qs}`;
  }

  const nav = (
    <nav className="no-print flex flex-wrap gap-x-6">
      {resultsHref && (
        <Link
          href={resultsHref}
          className="inline-flex min-h-11 items-center text-base font-medium text-primary underline"
        >
          {t("nav.backResults")}
        </Link>
      )}
      <Link
        href={homeHref}
        className="inline-flex min-h-11 items-center text-base font-medium text-primary underline"
      >
        {t("nav.newSearch")}
      </Link>
    </nav>
  );

  let trial: TrialDetailWithOutcomes | null;
  try {
    trial = await loadTrial(nct, mock);
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
        {nav}
        <p role="alert" className="mt-4 text-lg text-ink">
          {t("results.error")}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={`/${lang}/trial/${encodeURIComponent(nct)}${query ? `?${query}` : ""}`}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-5 text-base font-medium text-white hover:bg-primary-hover"
          >
            {t("results.retry")}
          </a>
        </div>
      </div>
    );
  }
  if (!trial) notFound();

  // Trial facts come from ClinicalTrials.gov in English; mark them so screen readers switch voice.
  const enLang = lang !== "en" ? "en" : undefined;
  const site = trial.nearestSite;
  // The quick check needs the real criteria text: with no questions (e.g. the model failed),
  // text with content keeps the structured-checks-only result, and only a study with no usable
  // text gets "insufficient-info". Blanking it here made every trial look criteria-less.
  const { minAgeYears, maxAgeYears, sex, healthyVolunteers, criteriaText } = trial.eligibility;
  const eligibility: Eligibility = {
    minAgeYears,
    maxAgeYears,
    sex,
    healthyVolunteers,
    criteriaText,
  };

  return (
    <article>
      {nav}

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
        eligibility={eligibility}
        dict={dict}
      />

      <StudyResults nctId={trial.nctId} outcomes={trial.outcomes} t={t} />

      <GettingThere site={site} stops={trial.stops} origin={origin} t={t} />

      <ContactCard
        nctId={trial.nctId}
        contacts={trial.contacts}
        t={t}
        printLabel={t("contact.print")}
      />

      <p className="mt-6 border-t border-line pt-6">
        <a
          href={`https://clinicaltrials.gov/study/${encodeURIComponent(trial.nctId)}`}
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

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// The search a person came from (TrialListItem passes cond, lat, lon, radius through), used for
// "Back to results" and as the directions origin. The results page re-validates all of it.
function parseSearch(sp: SearchParams) {
  const cond = first(sp.cond).trim();
  const latRaw = first(sp.lat).trim();
  const lonRaw = first(sp.lon).trim();
  const radius = first(sp.radius).trim();
  if (!cond || !latRaw || !lonRaw || !radius) return undefined;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { cond, lat, lon, latRaw, lonRaw, radius };
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

// The static shell. `lang` is a root param with generateStaticParams, so it is known while
// prerendering even though [nct] is not.
async function TrialSkeleton() {
  const raw = await rootLang();
  const t = translator(getDictionary(isLang(raw) ? raw : "en"));
  return (
    <div>
      <p role="status" className="sr-only">
        {t("trial.loading")}
      </p>
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
    </div>
  );
}
