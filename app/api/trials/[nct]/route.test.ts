// Tests for GET /api/trials/[nct] (spec: trial-search-api, Task 8).
//
// The route handler is the I/O layer, so the only thing mocked is the upstream `fetch`.
// Pure parsing/correction (lib/clinicaltrials.ts + lib/facilities.ts) runs for real against
// in-repo fixtures — no network. The detail cache in lib/cache.ts is keyed by the NCT ID,
// so each test uses a DISTINCT NCT id to keep cache entries from bleeding between cases
// (mirroring the search test's unique-`cond` approach).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CtgStudiesResponse, CtgStudy } from "../../../../lib/api-types";
import { BOSTON_CENTROID } from "../../../../lib/facilities";
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures — raw CtgStudy shapes at the shared Boston centroid, so the handler must route
// through the facility-coordinate correction in lib/facilities.ts (same pattern as the
// search route test).
// ---------------------------------------------------------------------------

const CENTROID = { lat: BOSTON_CENTROID.lat, lon: BOSTON_CENTROID.lon };

/** Dorchester reference origin (docs/DEMO_DATA.md). */
const DORCHESTER = { lat: 42.3016, lon: -71.0676 };

/**
 * A recruiting MA study at the Boston centroid with the given facility name, plus a second
 * recruiting MA site so "first qualifying site" vs "nearest site" can differ when no origin
 * is supplied. The first site is Boston Medical Center; the second is MGH.
 */
function bmcStudy(nctId: string): CtgStudy {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: "THRIVE-DM — Type 2 Diabetes" },
      conditionsModule: { conditions: ["Type 2 Diabetes"] },
      designModule: { phases: ["PHASE2"] },
      descriptionModule: { briefSummary: "A diabetes trial at BMC." },
      eligibilityModule: {
        eligibilityCriteria: "Adults 18+ with type 2 diabetes.",
        sex: "ALL",
        minimumAge: "18 Years",
        maximumAge: "75 Years",
        healthyVolunteers: false,
      },
      contactsLocationsModule: {
        centralContacts: [
          { name: "Study Coordinator", phone: "617-555-0100", email: "thrive@bmc.org", role: "CONTACT" },
        ],
        locations: [
          {
            facility: "Boston Medical Center",
            city: "Boston",
            state: "Massachusetts",
            zip: "02118",
            status: "RECRUITING",
            geoPoint: { lat: CENTROID.lat, lon: CENTROID.lon },
          },
          {
            facility: "Massachusetts General Hospital",
            city: "Boston",
            state: "Massachusetts",
            zip: "02114",
            status: "RECRUITING",
            geoPoint: { lat: CENTROID.lat, lon: CENTROID.lon },
          },
        ],
      },
    },
  };
}

function makeRequest(nct: string, params: Record<string, string> = {}): Request {
  const qs = new URLSearchParams(params).toString();
  const suffix = qs ? `?${qs}` : "";
  return new Request(`http://localhost:3000/api/trials/${nct}${suffix}`);
}

function makeContext(nct: string): { params: Promise<{ nct: string }> } {
  return { params: Promise.resolve({ nct }) };
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

// Unique NCT id per test so the ID-keyed cache never serves a prior test's result.
let nctCounter = 0;
const uniqueNct = () => `NCT9900${String(nctCounter++).padStart(4, "0")}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 200 — successful detail mapping into a full TrialDetail.
// ---------------------------------------------------------------------------

describe("GET /api/trials/[nct] — success", () => {
  it("returns a full TrialDetail with corrected coordinates, eligibility, contacts, and stops: []", async () => {
    const nct = uniqueNct();
    mockFetchOk({ studies: [bmcStudy(nct)], totalCount: 1 });

    const res = await GET(
      makeRequest(nct, { lat: String(DORCHESTER.lat), lon: String(DORCHESTER.lon) }),
      makeContext(nct),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();

    expect(body.nctId).toBe(nct);
    expect(body.title).toBe("THRIVE-DM — Type 2 Diabetes");
    expect(body.conditions).toEqual(["Type 2 Diabetes"]);
    expect(body.phase).toBe("Phase 2");
    expect(body.briefSummary).toBe("A diabetes trial at BMC.");
    // stops is always [] in this spec (getting-there fills it later).
    expect(body.stops).toEqual([]);
    // Both qualifying MA sites survive and are coordinate-corrected off the centroid.
    expect(body.sites).toHaveLength(2);
    expect(body.sites[0].locationPrecision).toBe("facility");
    expect(body.sites[0].lat).toBeCloseTo(42.335, 3);
    expect(body.sites[0].lon).toBeCloseTo(-71.0728, 3);
    // Eligibility was parsed from the raw module.
    expect(body.eligibility.minAgeYears).toBe(18);
    expect(body.eligibility.maxAgeYears).toBe(75);
    expect(body.eligibility.sex).toBe("ALL");
    expect(body.eligibility.healthyVolunteers).toBe(false);
    // Central contact passed through verbatim.
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].phone).toBe("617-555-0100");
    expect(body.contacts[0].email).toBe("thrive@bmc.org");
  });

  it("with lat/lon: computes a finite non-zero distance and picks the nearest corrected site", async () => {
    const nct = uniqueNct();
    mockFetchOk({ studies: [bmcStudy(nct)], totalCount: 1 });

    const res = await GET(
      makeRequest(nct, { lat: String(DORCHESTER.lat), lon: String(DORCHESTER.lon) }),
      makeContext(nct),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // From Dorchester, BMC (42.3350,-71.0728) is nearer than MGH (42.3625,-71.0694).
    expect(body.nearestSite.name).toBe("Boston Medical Center");
    expect(body.distanceMi).toBeGreaterThan(0);
    expect(Number.isFinite(body.distanceMi)).toBe(true);
  });

  it("without lat/lon: distanceMi is 0 and nearestSite is the first qualifying corrected site", async () => {
    const nct = uniqueNct();
    mockFetchOk({ studies: [bmcStudy(nct)], totalCount: 1 });

    // No lat/lon query params → no origin passed to toDetail.
    const res = await GET(makeRequest(nct), makeContext(nct));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.distanceMi).toBe(0);
    // First qualifying site is BMC (listed first), still coordinate-corrected.
    expect(body.nearestSite.name).toBe("Boston Medical Center");
    expect(body.nearestSite.locationPrecision).toBe("facility");
    expect(body.nearestSite.lat).toBeCloseTo(42.335, 3);
  });

  it("treats non-numeric lat/lon as no origin (distanceMi 0), not a 400", async () => {
    const nct = uniqueNct();
    mockFetchOk({ studies: [bmcStudy(nct)], totalCount: 1 });

    const res = await GET(makeRequest(nct, { lat: "abc", lon: "" }), makeContext(nct));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.distanceMi).toBe(0);
    expect(body.nearestSite.name).toBe("Boston Medical Center");
  });
});

// ---------------------------------------------------------------------------
// 404 — no study matches the NCT ID.
// ---------------------------------------------------------------------------

describe("GET /api/trials/[nct] — 404", () => {
  it("returns 404 with a JSON error body when studies is empty", async () => {
    const nct = uniqueNct();
    mockFetchOk({ studies: [], totalCount: 0 });

    const res = await GET(makeRequest(nct), makeContext(nct));

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 404 when the studies array is missing entirely", async () => {
    const nct = uniqueNct();
    mockFetchOk({ totalCount: 0 });

    const res = await GET(makeRequest(nct), makeContext(nct));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// 502 / 504 — upstream failure (nothing cached → the catch handler produces the status).
// ---------------------------------------------------------------------------

describe("GET /api/trials/[nct] — upstream failure", () => {
  it("returns 502 when the upstream responds non-OK and nothing is cached", async () => {
    const nct = uniqueNct();
    const fetchMock = vi.fn(async () => new Response("bad gateway", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest(nct), makeContext(nct));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 502 when the fetch rejects (network error) and nothing is cached", async () => {
    const nct = uniqueNct();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest(nct), makeContext(nct));

    expect(res.status).toBe(502);
  });

  it("returns 504 when the upstream request times out (aborts) and nothing is cached", async () => {
    const nct = uniqueNct();
    const fetchMock = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest(nct), makeContext(nct));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});
