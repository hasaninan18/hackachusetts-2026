// Load a national snapshot (scripts/snapshot-us.ts) into a local PGlite database with PostGIS,
// then optionally compare database search against the live ClinicalTrials.gov search path.
//
//   npm run db:load                       # newest full snapshot → data/pglite
//   npm run db:load -- --compare          # also compare against live ClinicalTrials.gov
//   npm run db:load -- --file data/snapshot/us-2026-11-01.ndjson
//
// Production will run the same applySchema / loadRows against Neon or Supabase; only the
// client changes (lib/db/trials.ts takes anything with query(text, params)).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import type { CtgStudiesResponse } from "../lib/api-types";
import { buildSearchUrl, slimStudy, withinRadius } from "../lib/clinicaltrials";
import { applySchema, loadRows, searchTrials } from "../lib/db/trials";
import type { SiteRow, TrialRow } from "../lib/ingest/ctgov";
import { REGIONS } from "../lib/region";

const SNAPSHOT_DIR = join("data", "snapshot");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function newestFullSnapshot(): string {
  const files = readdirSync(SNAPSHOT_DIR)
    .filter((f) => /^us-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f))
    .sort();
  if (files.length === 0) throw new Error("no snapshot found; run npm run snapshot:us first");
  return join(SNAPSHOT_DIR, files[files.length - 1]);
}

/** Probes for --compare: one per kind of place (MA demo, big metro, mid-size, rural-ish). */
const PROBES = [
  { label: "Dorchester MA, diabetes, 10 mi", lat: 42.29, lon: -71.08, radiusMi: 10, cond: "diabetes" },
  { label: "Houston TX, breast cancer, 10 mi", lat: 29.71, lon: -95.4, radiusMi: 10, cond: "breast cancer" },
  { label: "Seattle WA, asthma, 25 mi", lat: 47.61, lon: -122.33, radiusMi: 25, cond: "asthma" },
  { label: "Des Moines IA, depression, 25 mi", lat: 41.59, lon: -93.62, radiusMi: 25, cond: "depression" },
];

/** The current per-request path: ClinicalTrials.gov search + our site filter, US region. */
async function liveIds(p: (typeof PROBES)[number]): Promise<Set<string>> {
  const res = await fetch(buildSearchUrl({ cond: p.cond, lat: p.lat, lon: p.lon, radius: p.radiusMi }), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ClinicalTrials.gov ${res.status}`);
  const body = (await res.json()) as CtgStudiesResponse;
  const slim = (body.studies ?? [])
    .map((s) => slimStudy(s, { lat: p.lat, lon: p.lon }, REGIONS.us))
    .filter((t) => t !== null);
  return new Set(withinRadius(slim, p.radiusMi).map((t) => t.nctId));
}

async function main() {
  const file = argValue("--file") ?? newestFullSnapshot();
  const dir = argValue("--dir") ?? join("data", "pglite");
  const isFull = !file.includes("-since-");

  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { trial: TrialRow; sites: SiteRow[] });

  console.log(`opening ${dir} (PGlite + PostGIS)…`);
  const db = new PGlite(dir, { extensions: { postgis } });
  await applySchema(db);

  const started = Date.now();
  const result = await loadRows(db, rows, { prune: isFull });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  await db.query(
    "insert into import_runs (finished_at, trials, sites, report) values (now(), $1, $2, $3::jsonb)",
    [result.trials, result.sites, JSON.stringify({ file, pruned: result.pruned })],
  );
  console.log(`loaded ${result.trials} trials, ${result.sites} sites from ${file} in ${seconds}s (pruned ${result.pruned})`);

  if (process.argv.includes("--compare")) {
    console.log("\ndatabase search vs live ClinicalTrials.gov search (US region):");
    for (const p of PROBES) {
      const t0 = Date.now();
      const dbIds = new Set((await searchTrials(db, { ...p, limit: 1000 })).map((t) => t.nctId));
      const dbMs = Date.now() - t0;
      const live = await liveIds(p);
      const both = [...dbIds].filter((id) => live.has(id)).length;
      console.log(
        `  ${p.label}: db ${dbIds.size} (${dbMs} ms), live ${live.size}, both ${both}, ` +
          `db-only ${dbIds.size - both}, live-only ${live.size - both}`,
      );
      await new Promise((r) => setTimeout(r, 750));
    }
    console.log("  (live is capped at 50 studies per request — see buildSearchUrl pageSize)");
  }
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
