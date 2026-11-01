// Which database, if any, /api/trials searches (docs/NATIONAL_PLAN.md §2).
//
// TRIALPATH_PGLITE_DIR=data/pglite → the local PGlite + PostGIS database that
// `npm run db:load` fills. Unset → null, and routes keep calling ClinicalTrials.gov live,
// so production is unchanged until a hosted database is chosen. PGlite is for local
// development only: one process at a time, so stop the dev server before `npm run db:load`.

import type { Queryable } from "./trials";

let pending: Promise<Queryable | null> | undefined;

async function openPglite(dir: string): Promise<Queryable> {
  // Loaded on demand so builds without a database never touch the WASM packages.
  const [{ PGlite }, { postgis }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite-postgis"),
  ]);
  const db = new PGlite(dir, { extensions: { postgis } });
  await db.waitReady;
  return db;
}

/** The configured database, opened once per server process; null when none is configured. */
export function getDb(): Promise<Queryable | null> {
  const dir = process.env.TRIALPATH_PGLITE_DIR;
  if (!dir) return Promise.resolve(null);
  pending ??= openPglite(dir).catch((err) => {
    console.error(`[db] could not open PGlite at ${dir}; using ClinicalTrials.gov`, err);
    pending = undefined; // retry on the next request
    return null;
  });
  return pending;
}
