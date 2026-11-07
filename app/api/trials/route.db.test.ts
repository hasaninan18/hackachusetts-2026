// Tests for GET /api/trials when a national database is configured (docs/NATIONAL_PLAN.md
// §2). lib/db/client.ts is mocked with a fake Queryable, so these cover the route's wiring
// and fallback; the SQL itself is covered by lib/db/trials.test.ts on a real PGlite.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../../lib/db/trials";

const getDb = vi.fn<() => Promise<Queryable | null>>();
vi.mock("../../../lib/db/client", () => ({ getDb: () => getDb() }));

const { GET } = await import("./route");

function makeRequest(params: Record<string, string>): Request {
  return new Request(`http://localhost/api/trials?${new URLSearchParams(params)}`);
}

const ROW = {
  nct_id: "NCT01234567",
  title: "A Houston study",
  conditions: ["Asthma"],
  phase: "Phase 2",
  facility: "MD Anderson",
  city: "Houston",
  zip: "77030",
  location_precision: "city",
  lat: 29.76,
  lon: -95.36,
  meters: 1609.344 * 2.5,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ studies: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  getDb.mockReset();
});

describe("GET /api/trials — database configured", () => {
  it("searches the database, not ClinicalTrials.gov, and keeps the response shape", async () => {
    const query = vi.fn<(text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>(
      async () => ({ rows: [ROW] }),
    );
    getDb.mockResolvedValue({ query } as unknown as Queryable);

    const res = await GET(makeRequest({ lat: "29.71", lon: "-95.40", radius: "10", cond: "asma" }));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      total: 1,
      trials: [
        {
          nctId: "NCT01234567",
          title: "A Houston study",
          conditions: ["Asthma"],
          phase: "Phase 2",
          nearestSite: { name: "MD Anderson", city: "Houston", zip: "77030", lat: 29.76, lon: -95.36, locationPrecision: "city" },
          distanceMi: 2.5,
        },
      ],
    });

    const params = query.mock.calls[0][1] as unknown[];
    // lat, lon, radius in meters, English condition (es "asma" translated), limit, states.
    expect(params.slice(0, 4)).toEqual([29.71, -95.4, 10 * 1609.344, "Asthma"]);
    expect(params[4]).toBe(200);
    // Tests run with no region set, so the build's region is MA.
    expect(params[5]).toEqual(["MA"]);
  });

  it("falls back to ClinicalTrials.gov when the database search throws", async () => {
    const query = vi.fn(async () => {
      throw new Error("db down");
    });
    getDb.mockResolvedValue({ query } as unknown as Queryable);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeRequest({ lat: "42.29", lon: "-71.08", cond: "db-fallback-probe" }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ trials: [], total: 0 });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("still validates lat/lon before touching the database", async () => {
    const res = await GET(makeRequest({ lon: "-71.08" }));
    expect(res.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("GET /api/trials — no database", () => {
  it("uses ClinicalTrials.gov exactly as before", async () => {
    getDb.mockResolvedValue(null);
    const res = await GET(makeRequest({ lat: "42.29", lon: "-71.08", cond: "no-db-probe" }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
