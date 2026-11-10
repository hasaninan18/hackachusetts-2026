// Postgres + PostGIS access for the national database (db/schema.sql, NATIONAL_PLAN.md §2).
//
// Client-agnostic: anything with `query(text, params)` works — PGlite locally and in tests,
// node-postgres / Neon in production. Search returns the same TrialSummary shape the live
// ClinicalTrials.gov path does, so the UI contract does not change.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteRow, TrialRow } from "../ingest/ctgov";
import { classifyEnglish } from "../ingest/quality";
import type { Site, TrialSummary } from "../types";

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec?(text: string): Promise<unknown>;
}

const METERS_PER_MILE = 1609.344;

/** Rows per statement: well under Postgres' parameter and statement-size limits. */
const BATCH = 500;

/** Run db/schema.sql (idempotent). */
export async function applySchema(db: Queryable, root = process.cwd()): Promise<void> {
  const sql = readFileSync(join(root, "db", "schema.sql"), "utf8");
  if (db.exec) await db.exec(sql);
  else await db.query(sql);
}

const UPSERT_TRIALS = `
insert into trials (nct_id, title, conditions, terms, phase, brief_summary, eligibility,
                    sponsor, last_update, contacts, english, imported_at)
select x.nct_id, x.title, x.conditions, x.terms, x.phase, x.brief_summary, x.eligibility,
       x.sponsor, x.last_update, x.contacts, x.english, now()
  from jsonb_to_recordset($1::jsonb) as x(
         nct_id text, title text, conditions text[], terms text[], phase text,
         brief_summary text, eligibility jsonb, sponsor text, last_update date,
         contacts jsonb, english text)
on conflict (nct_id) do update set
  title = excluded.title, conditions = excluded.conditions, terms = excluded.terms,
  phase = excluded.phase, brief_summary = excluded.brief_summary,
  eligibility = excluded.eligibility, sponsor = excluded.sponsor,
  last_update = excluded.last_update, contacts = excluded.contacts,
  english = excluded.english, imported_at = now()`;

const DELETE_SITES = `delete from sites where nct_id = any($1::text[])`;

const INSERT_SITES = `
insert into sites (nct_id, ordinal, facility, city, state, zip, location, location_precision)
select x.nct_id, x.ordinal, x.facility, x.city, x.state, x.zip,
       st_setsrid(st_makepoint(x.lon, x.lat), 4326)::geography, x.location_precision
  from jsonb_to_recordset($1::jsonb) as x(
         nct_id text, ordinal integer, facility text, city text, state text, zip text,
         lat double precision, lon double precision, location_precision text)`;

const PRUNE_TRIALS = `delete from trials where not (nct_id = any($1::text[]))`;

function trialParam(t: TrialRow) {
  return {
    nct_id: t.nctId,
    title: t.title,
    conditions: t.conditions,
    terms: t.terms,
    phase: t.phase,
    brief_summary: t.briefSummary,
    eligibility: t.eligibility,
    sponsor: t.sponsor,
    last_update: t.lastUpdate,
    contacts: t.contacts,
    english: classifyEnglish(t.eligibility?.eligibilityCriteria ?? ""),
  };
}

function siteParam(s: SiteRow) {
  return {
    nct_id: s.nctId,
    ordinal: s.ordinal,
    facility: s.name,
    city: s.city,
    state: s.state,
    zip: s.zip ?? null,
    lat: s.lat,
    lon: s.lon,
    location_precision: s.locationPrecision,
  };
}

/**
 * Upsert trials and replace their sites, in batches inside one transaction. With
 * `prune: true` (a full pull, not a `--since` update), trials missing from `rows` — no longer
 * recruiting — are deleted along with their sites.
 */
export async function loadRows(
  db: Queryable,
  rows: { trial: TrialRow; sites: SiteRow[] }[],
  { prune = false }: { prune?: boolean } = {},
): Promise<{ trials: number; sites: number; pruned: number }> {
  let sites = 0;
  let pruned = 0;
  await db.query("begin");
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await db.query(UPSERT_TRIALS, [JSON.stringify(batch.map((r) => trialParam(r.trial)))]);
      await db.query(DELETE_SITES, [batch.map((r) => r.trial.nctId)]);
      const siteRows = batch.flatMap((r) => r.sites.map(siteParam));
      for (let j = 0; j < siteRows.length; j += BATCH * 4) {
        await db.query(INSERT_SITES, [JSON.stringify(siteRows.slice(j, j + BATCH * 4))]);
      }
      sites += siteRows.length;
    }
    if (prune) {
      const res = await db.query<{ n: number }>(
        `with gone as (${PRUNE_TRIALS} returning 1) select count(*)::int as n from gone`,
        [rows.map((r) => r.trial.nctId)],
      );
      pruned = res.rows[0]?.n ?? 0;
    }
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  return { trials: rows.length, sites, pruned };
}

export interface SearchQuery {
  lat: number;
  lon: number;
  radiusMi: number;
  /** Free-text condition in English (lib/condition-terms.ts translates first); "" = any. */
  cond: string;
  /** USPS codes of the states to search (the build's region); omitted = every state. */
  states?: readonly string[];
  limit?: number;
}

const SEARCH_TRIALS = `
with nearest as (
  select distinct on (s.nct_id)
         s.nct_id, s.facility, s.city, s.zip, s.location_precision,
         st_y(s.location::geometry) as lat, st_x(s.location::geometry) as lon,
         st_distance(s.location, st_makepoint($2, $1)::geography) as meters
    from sites s
   where st_dwithin(s.location, st_makepoint($2, $1)::geography, $3)
     and ($6::text[] is null or s.state = any($6::text[]))
   order by s.nct_id, meters
)
select t.nct_id, t.title, t.conditions, t.phase, n.facility, n.city, n.zip,
       n.location_precision, n.lat, n.lon, n.meters,
       -- every match before LIMIT: window functions run before LIMIT is applied
       (count(*) over ())::int as total
  from nearest n
  join trials t using (nct_id)
 where $4 = '' or t.search @@ websearch_to_tsquery('english', $4)
 order by n.meters, t.nct_id
 limit $5`;

interface SearchRow {
  nct_id: string;
  title: string;
  conditions: string[];
  phase: string | null;
  facility: string;
  city: string;
  zip: string | null;
  location_precision: Site["locationPrecision"];
  lat: number;
  lon: number;
  meters: number;
  /** Matches before LIMIT (the same on every row). */
  total?: number;
}

/** Trials with a site within the radius, nearest site first; same shape as /api/trials. */
export async function searchTrials(db: Queryable, q: SearchQuery): Promise<TrialSummary[]> {
  return (await searchTrialsWithTotal(db, q)).trials;
}

/**
 * {@link searchTrials} plus `total`: the number of in-radius matches before the `limit`, so a
 * search with more matches than the limit can report how many there are (as the live path
 * does). Counted by the same query, so `trials` and `total` always describe the same search.
 */
export async function searchTrialsWithTotal(
  db: Queryable,
  q: SearchQuery,
): Promise<{ trials: TrialSummary[]; total: number }> {
  const { rows } = await db.query<SearchRow>(SEARCH_TRIALS, [
    q.lat,
    q.lon,
    q.radiusMi * METERS_PER_MILE,
    q.cond.trim(),
    q.limit ?? 50,
    q.states ? [...q.states] : null,
  ]);
  const trials = rows.map((r) => {
    const nearestSite: Site = {
      name: r.facility,
      city: r.city,
      lat: r.lat,
      lon: r.lon,
      locationPrecision: r.location_precision,
    };
    if (r.zip !== null) nearestSite.zip = r.zip;
    return {
      nctId: r.nct_id,
      title: r.title,
      conditions: r.conditions,
      phase: r.phase,
      nearestSite,
      distanceMi: r.meters / METERS_PER_MILE,
    };
  });
  // Every row carries the same window count. A Queryable that does not return the column
  // (a test double) falls back to the rows it returned, which was the previous behavior.
  const counted = rows.length > 0 ? Number(rows[0].total) : 0;
  const total = Number.isFinite(counted) ? Math.max(counted, trials.length) : trials.length;
  return { trials, total };
}
