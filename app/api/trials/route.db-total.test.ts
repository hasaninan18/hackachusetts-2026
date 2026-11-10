// GET /api/trials on the database path must report the real number of in-radius matches as
// `total`, while `trials` stays the nearest RESULT_LIMIT (200). Before this fix the route
// returned `total: trials.length`, so a search with more than 200 matches reported exactly
// 200 and the results page never said "Showing the 200 closest" the way the live path does.
//
// Runs against a real Postgres (PGlite + PostGIS, in memory, no network) so the count comes
// from the actual SQL, not from a fake query.

import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CtgLocation, TrialsResponse } from "../../../lib/api-types";
import { RESULT_LIMIT } from "../../../lib/clinicaltrials";
import { type IngestStudy, toRows } from "../../../lib/ingest/ctgov";
import { applySchema, loadRows, type Queryable } from "../../../lib/db/trials";

const getDb = vi.fn<() => Promise<Queryable | null>>();
vi.mock("../../../lib/db/client", () => ({ getDb: () => getDb() }));

const { GET } = await import("./route");

const DORCHESTER = { lat: 42.29, lon: -71.08 };

function site(i: number, lat: number, lon: number): CtgLocation {
  return {
    country: "United States",
    status: "RECRUITING",
    facility: `Clinic ${i}`,
    city: "Boston",
    state: "Massachusetts",
    zip: "02118",
    geoPoint: { lat, lon },
  };
}

function study(nctId: string, condition: string, location: CtgLocation): IngestStudy {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: `${condition} study ${nctId}` },
      conditionsModule: { conditions: [condition] },
      eligibilityModule: { eligibilityCriteria: "" },
      contactsLocationsModule: { locations: [location] },
    },
    derivedSection: { conditionBrowseModule: { meshes: [{ term: condition }] } },
  };
}

const nct = (n: number) => `NCT${String(n).padStart(8, "0")}`;

// More than RESULT_LIMIT asthma trials within a few miles of Dorchester…
const MANY = RESULT_LIMIT + 5;
// …plus asthma trials in Springfield, MA (~80 mi away): outside a 10-mile radius.
const FAR = 7;
// …and a handful of diabetes trials nearby, for the under-the-limit control.
const FEW = 3;

const STUDIES: IngestStudy[] = [
  ...Array.from({ length: MANY }, (_, i) =>
    study(nct(1 + i), "Asthma", site(i, 42.3 + i * 0.0001, -71.07 - i * 0.0001)),
  ),
  ...Array.from({ length: FAR }, (_, i) => study(nct(1000 + i), "Asthma", site(1000 + i, 42.1, -72.59))),
  ...Array.from({ length: FEW }, (_, i) =>
    study(nct(2000 + i), "Diabetes Mellitus", site(2000 + i, 42.31 + i * 0.001, -71.06)),
  ),
];

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis } });
  await applySchema(db);
  await loadRows(db, STUDIES.map((s) => toRows(s)!), { prune: true });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getDb.mockResolvedValue(db as unknown as Queryable);
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ studies: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  getDb.mockReset();
});

async function search(cond: string): Promise<TrialsResponse> {
  const params = new URLSearchParams({ lat: String(DORCHESTER.lat), lon: String(DORCHESTER.lon), radius: "10", cond });
  const res = await GET(new Request(`http://localhost/api/trials?${params}`));
  expect(res.status).toBe(200);
  expect(fetchMock).not.toHaveBeenCalled(); // answered by the database, not ClinicalTrials.gov
  return (await res.json()) as TrialsResponse;
}

describe("GET /api/trials — database total", () => {
  it("reports every in-radius match as total when there are more than RESULT_LIMIT", async () => {
    const body = await search("asthma");
    expect(body.trials).toHaveLength(RESULT_LIMIT);
    expect(body.total).toBeGreaterThan(body.trials.length);
    // Exactly the in-radius matches: the Springfield trials are outside 10 miles.
    expect(body.total).toBe(MANY);
    // trials is still the nearest RESULT_LIMIT, nearest first.
    const distances = body.trials.map((t) => t.distanceMi);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(body.trials.map((t) => t.nctId)).not.toContain(nct(MANY));
  });

  it("control: under RESULT_LIMIT, total equals the number of trials returned", async () => {
    const body = await search("diabetes");
    expect(body.trials).toHaveLength(FEW);
    expect(body.total).toBe(FEW);
  });

  it("control: no matches gives an empty list and total 0", async () => {
    const body = await search("leukemia");
    expect(body).toEqual({ trials: [], total: 0 });
  });
});
