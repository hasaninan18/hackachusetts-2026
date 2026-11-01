// Pull every recruiting US study from ClinicalTrials.gov and write a local snapshot plus a
// data-quality report (docs/NATIONAL_PLAN.md, Phase A).
//
//   npm run snapshot:us                 # full pull
//   npm run snapshot:us -- --since 2026-10-31
//
// Writes (git-ignored):
//   data/snapshot/us-<date>.ndjson      one { trial, sites } row per study
//   data/snapshot/us-<date>.report.json lib/ingest/quality.ts report
//
// Sequential and polite: one request at a time, a short pause between pages.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type IngestPage, type ZipCentroid, buildUsPageUrl, toRows } from "../lib/ingest/ctgov";
import { markSharedPointsAsCity, qualityReport } from "../lib/ingest/quality";
import { REGIONS } from "../lib/region";

const OUT_DIR = join("data", "snapshot");
const PAUSE_MS = 750;
const TIMEOUT_MS = 60_000;
const MAX_PAGES = 100;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** ZIP centroids from public/zcta/, loaded per prefix on demand. */
function diskZipCentroid(): ZipCentroid {
  const shards = new Map<string, Record<string, [number, number, string]> | null>();
  return (zip) => {
    if (!/^\d{5}$/.test(zip)) return null;
    const prefix = zip.slice(0, 3);
    if (!shards.has(prefix)) {
      try {
        shards.set(prefix, JSON.parse(readFileSync(join("public", "zcta", `${prefix}.json`), "utf8")));
      } catch {
        shards.set(prefix, null);
      }
    }
    const entry = shards.get(prefix)?.[zip];
    return entry ? { lat: entry[0], lon: entry[1] } : null;
  };
}

async function fetchPage(url: string): Promise<IngestPage> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "TrialPath-snapshot/0.1" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as IngestPage;
    } catch (err) {
      if (attempt >= 4) throw err;
      const wait = 2 ** attempt * 1000;
      console.warn(`  retry ${attempt} in ${wait / 1000}s (${(err as Error).message})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function main() {
  const since = argValue("--since");
  const started = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const zipCentroid = diskZipCentroid();

  const rows: NonNullable<ReturnType<typeof toRows>>[] = [];
  let studiesSeen = 0;
  let dropped = 0;
  let pageToken: string | undefined;
  let total: number | undefined;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await fetchPage(buildUsPageUrl({ pageToken, since }));
    total ??= body.totalCount;
    for (const study of body.studies ?? []) {
      studiesSeen++;
      const r = toRows(study, REGIONS.us, zipCentroid);
      if (r) {
        rows.push(r);
        dropped += r.droppedNoLocation;
      }
    }
    console.log(`page ${page}: ${studiesSeen}/${total ?? "?"} studies, ${rows.length} with a recruiting US site`);
    pageToken = body.nextPageToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  if (pageToken) throw new Error(`stopped after ${MAX_PAGES} pages with more remaining`);
  // Shared points are only visible across studies, so label them after the full pull.
  const marked = markSharedPointsAsCity(rows);

  mkdirSync(OUT_DIR, { recursive: true });
  const base = join(OUT_DIR, `us-${date}${since ? `-since-${since}` : ""}`);
  writeFileSync(
    `${base}.ndjson`,
    marked.map(({ trial, sites }) => JSON.stringify({ trial, sites })).join("\n") + "\n",
  );
  const report = {
    generatedAt: new Date().toISOString(),
    since: since ?? null,
    upstreamTotal: total ?? null,
    studiesSeen,
    seconds: Math.round((Date.now() - started) / 1000),
    ...qualityReport(marked, dropped),
  };
  writeFileSync(`${base}.report.json`, JSON.stringify(report, null, 2) + "\n");

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
  console.log(`\nwrote ${base}.ndjson and ${base}.report.json in ${report.seconds}s`);
  console.log(`trials with a recruiting US site: ${report.trials}`);
  console.log(`recruiting US sites: ${report.sites} (dropped, no location: ${report.sitesDroppedNoLocation})`);
  console.log(`sites on shared city-centroid points: ${report.sitesOnSharedPoints} (${pct(report.sitesOnSharedPoints, report.sites)}) across ${report.sharedPointCount} points`);
  console.log(`English in eligibility: required ${report.english.required}, required-or-other ${report.english["required-or-other"]}, mentions only ${report.english.mentions} (of ${report.trials})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
