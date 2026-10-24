// Tests for GET /api/trials (spec: trial-search-api, Task 7).
//
// The route handler is the I/O layer, so the only thing mocked is the upstream `fetch`.
// Pure parsing/ranking (lib/clinicaltrials.ts) runs for real against in-repo fixtures —
// no network. Each test uses a DISTINCT `cond` so the module-scope cache in lib/cache.ts
// (keyed by the full upstream URL, which contains `cond`) never bleeds between cases.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CtgStudiesResponse, CtgStudy } from "../../../lib/api-types";
import { BOSTON_CENTROID } from "../../../lib/facilities";
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures — raw CtgStudy shapes at the shared Boston centroid, so the handler must
// route through the facility-coordinate correction in lib/facilities.ts.
// ---------------------------------------------------------------------------

const CENTROID = { lat: BOSTON_CENTROID.lat, lon: BOSTON_CENTROID.lon };

/** A recruiting MA study at the Boston centroid with the given facility name. */
function maStudy(nctId: string, facility: string, condition: string): CtgStudy {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: `${facility} — ${condition}` },
      conditionsModule: { conditions: [condition] },
      designModule: { phases: ["PHASE2"] },
      descriptionModule: { briefSummary: `A ${condition} trial.` },
      contactsLocationsModule: {
        locations: [
          {
            facility,
            city: "Boston",
            state: "Massachusetts",
            zip: "02118",
            status: "RECRUITING",
            geoPoint: { lat: CENTROID.lat, lon: CENTROID.lon },
          },
        ],
      },
    },
  };
}

/** A study whose only site is out of state → slimStudy returns null (dropped). */
function outOfStateStudy(nctId: string): CtgStudy {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: "NY study" },
      conditionsModule: { conditions: ["Asthma"] },
      contactsLocationsModule: {
        locations: [
          {
            facility: "Some NY Hospital",
            city: "New York",
            state: "New York",
            status: "RECRUITING",
            geoPoint: { lat: 40.7128, lon: -74.006 },
          },
        ],
      },
    },
  };
}

/** Dorchester reference origin (docs/DEMO_DATA.md). */
const DORCHESTER = { lat: 42.3016, lon: -71.0676 };

function makeRequest(params: Record<string, string>): Request {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://localhost:3000/api/trials?${qs}`);
}

/** Install a fetch mock returning the given upstream body with status 200. */
function mockFetchOk(body: CtgStudiesResponse) {
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Unique condition per test so the URL-keyed cache never serves a prior test's result.
let condCounter = 0;
const uniqueCond = (label: string) => `${label}-${condCounter++}`;

beforeEach(() => {
  condCounter = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 400 — missing / non-numeric lat or lon, with NO upstream call.
// ---------------------------------------------------------------------------

describe("GET /api/trials — 400 validation", () => {
  it("returns 400 and makes no upstream call when lat is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest({ lon: "-71.0676", cond: uniqueCond("nolat") }));

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 and makes no upstream call when lon is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest({ lat: "42.3016", cond: uniqueCond("nolon") }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 and makes no upstream call when lat is non-numeric", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      makeRequest({ lat: "abc", lon: "-71.0676", cond: uniqueCond("badlat") }),
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when lat is an empty string (not coerced to 0)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      makeRequest({ lat: "", lon: "-71.0676", cond: uniqueCond("emptylat") }),
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 200 — successful mapping + ranking into { trials, total }.
// ---------------------------------------------------------------------------

describe("GET /api/trials — success", () => {
  it("maps studies, corrects coordinates, ranks nearest-first, and returns { trials, total }", async () => {
    const cond = uniqueCond("diabetes");
    // MGH and BMC both at the centroid; after correction they sit at different real
    // buildings, so from Dorchester BMC is closer than MGH and must rank first.
    mockFetchOk({
      studies: [
        maStudy("NCT05784922", "Massachusetts General Hospital", cond),
        maStudy("NCT07043426", "Boston Medical Center", cond),
      ],
      totalCount: 2,
    });

    const res = await GET(
      makeRequest({
        cond,
        lat: String(DORCHESTER.lat),
        lon: String(DORCHESTER.lon),
        radius: "25",
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();

    expect(body.total).toBe(2);
    expect(body.trials).toHaveLength(2);
    // Nearest-first: BMC (42.3350,-71.0728) is closer to Dorchester than MGH.
    expect(body.trials[0].nctId).toBe("NCT07043426");
    expect(body.trials[1].nctId).toBe("NCT05784922");
    // Non-decreasing distance.
    expect(body.trials[1].distanceMi).toBeGreaterThanOrEqual(body.trials[0].distanceMi);
    // Coordinates were corrected off the shared centroid to the real BMC building.
    expect(body.trials[0].nearestSite.locationPrecision).toBe("facility");
    expect(body.trials[0].nearestSite.lat).toBeCloseTo(42.335, 3);
    expect(body.trials[0].nearestSite.lon).toBeCloseTo(-71.0728, 3);
  });

  it("drops studies with no qualifying MA site (slimStudy → null)", async () => {
    const cond = uniqueCond("asthma");
    mockFetchOk({
      studies: [
        maStudy("NCT07043426", "Boston Medical Center", cond),
        outOfStateStudy("NCT00000001"),
      ],
      totalCount: 2,
    });

    const res = await GET(
      makeRequest({
        cond,
        lat: String(DORCHESTER.lat),
        lon: String(DORCHESTER.lon),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the MA study survives; total reflects the post-filter count.
    expect(body.trials).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.trials[0].nctId).toBe("NCT07043426");
  });

  it("allows an empty/missing cond (location-only search) and still calls upstream", async () => {
    const fetchMock = mockFetchOk({ studies: [], totalCount: 0 });

    const res = await GET(
      makeRequest({ lat: String(DORCHESTER.lat), lon: String(DORCHESTER.lon) }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ trials: [], total: 0 });
    // Upstream WAS called (no cached entry for this unique URL), with an empty cond.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("query.cond=&");
    expect(calledUrl).toContain("filter.overallStatus=RECRUITING");
  });

  it("handles a missing studies array as an empty result", async () => {
    mockFetchOk({ totalCount: 0 });
    const res = await GET(
      makeRequest({
        cond: uniqueCond("empty"),
        lat: String(DORCHESTER.lat),
        lon: String(DORCHESTER.lon),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trials: [], total: 0 });
  });
});

// ---------------------------------------------------------------------------
// 502 / 504 — upstream failure (nothing cached → the catch handler produces the status).
// ---------------------------------------------------------------------------

describe("GET /api/trials — upstream failure", () => {
  it("returns 502 when the upstream responds non-OK and nothing is cached", async () => {
    const fetchMock = vi.fn(async () => new Response("bad gateway", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      makeRequest({
        cond: uniqueCond("fail502"),
        lat: String(DORCHESTER.lat),
        lon: String(DORCHESTER.lon),
      }),
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 502 when the fetch rejects (network error) and nothing is cached", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      makeRequest({
        cond: uniqueCond("failnet"),
        lat: String(DORCHESTER.lat),
        lon: String(DORCHESTER.lon),
      }),
    );

    expect(res.status).toBe(502);
  });

  it("returns 504 when the upstream request times out (aborts) and nothing is cached", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      makeRequest({
        cond: uniqueCond("fail504"),
        lat: String(DORCHESTER.lat),
        lon: String(DORCHESTER.lon),
      }),
    );

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});
