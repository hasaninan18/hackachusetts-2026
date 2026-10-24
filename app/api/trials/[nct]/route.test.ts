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


// ---------------------------------------------------------------------------
// getting-there — MBTA stops enrichment (spec: getting-there, Requirements 1, 5, 6, 8).
//
// The route makes TWO fetches: ClinicalTrials.gov (detail) then MBTA (stops). We route the
// mock by URL so CTG succeeds while MBTA independently succeeds/fails, proving the trial
// detail is never broken by an MBTA problem (stops fall back to []).
//
// NOTE on cache isolation: the MBTA fetch is cached by its REQUEST URL (lib/cache.ts), and
// that URL is derived from the anchor site coordinates. So each test uses a DISTINCT, non-
// centroid site coordinate — which correctCoordinates passes through verbatim as "facility"
// — giving a unique MBTA URL (and cache key) per test, mirroring the unique-NCT pattern.
// ---------------------------------------------------------------------------
const MBTA_HOST = "api-v3.mbta.com";

/** A recruiting MA study whose single site sits at a given NON-centroid coordinate. */
function siteStudy(nctId: string, lat: number, lon: number): CtgStudy {
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
            geoPoint: { lat, lon },
          },
        ],
      },
    },
  };
}

function mbtaStop(over: {
  id: string;
  name: string;
  lat: number;
  lon: number;
  vehicle_type: number;
  wheelchair_boarding?: number;
  parentId?: string;
}) {
  return {
    id: over.id,
    attributes: {
      name: over.name,
      latitude: over.lat,
      longitude: over.lon,
      vehicle_type: over.vehicle_type,
      wheelchair_boarding: over.wheelchair_boarding,
    },
    relationships: {
      parent_station: { data: over.parentId ? { id: over.parentId } : null },
    },
  };
}

/** Route the fetch mock by host: CTG returns `ctg`; MBTA runs `mbta(url)`. */
function mockFetchRouted(ctg: CtgStudiesResponse, mbta: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes(MBTA_HOST)) return mbta(url);
    return new Response(JSON.stringify(ctg), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Distinct non-centroid site coordinate per test → distinct MBTA URL/cache key.
let siteCounter = 0;
const uniqueSite = () => ({ lat: 42.4 + siteCounter * 1e-3, lon: -71.2 - siteCounter++ * 1e-3 });

describe("GET /api/trials/[nct] — MBTA stops enrichment", () => {
  it("populates stops (nearest-first, lines:[], wheelchair preserved) from the site's corrected coords", async () => {
    const nct = uniqueNct();
    const site = uniqueSite();
    const mbtaBody = {
      data: [
        // Nearest to the site (same point), accessible.
        mbtaStop({ id: "near", name: "Door Stop", lat: site.lat, lon: site.lon, vehicle_type: 3, wheelchair_boarding: 1 }),
        // Farther, not accessible.
        mbtaStop({ id: "far", name: "Farther Stop", lat: site.lat + 0.01, lon: site.lon + 0.01, vehicle_type: 3, wheelchair_boarding: 2 }),
      ],
    };
    const fetchMock = mockFetchRouted({ studies: [siteStudy(nct, site.lat, site.lon)], totalCount: 1 }, async () =>
      new Response(JSON.stringify(mbtaBody), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      }),
    );
    const res = await GET(makeRequest(nct), makeContext(nct));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stops.length).toBeGreaterThanOrEqual(1);
    // Nearest-first ordering.
    expect(body.stops[0].name).toBe("Door Stop");
    expect(body.stops[0].wheelchair).toBe(true);
    expect(body.stops[0].lines).toEqual([]);
    // MBTA was queried with the site's (facility-precision) coordinates, not the centroid.
    const mbtaCall = fetchMock.mock.calls.find(([u]) => String(u).includes(MBTA_HOST));
    expect(mbtaCall).toBeDefined();
    const mbtaUrl = new URL(String(mbtaCall![0]));
    expect(mbtaUrl.searchParams.get("filter[latitude]")).toBe(String(site.lat));
    expect(mbtaUrl.searchParams.get("filter[latitude]")).not.toBe(String(CENTROID.lat));
  });

  it("anchors MBTA on the CORRECTED BMC coords (not the centroid) when the site reports the centroid", async () => {
    const nct = uniqueNct();
    // Site at the shared Boston centroid → correctCoordinates maps BMC to 42.335,-71.0728,
    // which becomes the response's nearestSite and therefore the MBTA anchor.
    mockFetchRouted({ studies: [bmcStudy(nct)], totalCount: 1 }, async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      }),
    );
    const res = await GET(makeRequest(nct), makeContext(nct));
    expect(res.status).toBe(200);
    const body = await res.json();
    // nearestSite is the corrected BMC building, never the raw centroid.
    expect(body.nearestSite.lat).toBeCloseTo(42.335, 3);
    expect(body.nearestSite.lon).toBeCloseTo(-71.0728, 3);
    expect(body.nearestSite.lat).not.toBe(CENTROID.lat);
    expect(body.nearestSite.locationPrecision).toBe("facility");
    // Stops is always a valid array (empty here: the MBTA mock returned no data, or a
    // fresh cache entry from a prior BMC lookup served []).
    expect(Array.isArray(body.stops)).toBe(true);
  });

  it("returns 200 with stops: [] when the MBTA request fails (detail unaffected)", async () => {
    const nct = uniqueNct();
    const site = uniqueSite();
    mockFetchRouted({ studies: [siteStudy(nct, site.lat, site.lon)], totalCount: 1 }, async () => {
      throw new TypeError("mbta down");
    });
    const res = await GET(makeRequest(nct), makeContext(nct));
    expect(res.status).toBe(200);
    const body = await res.json();
    // ClinicalTrials.gov detail is intact...
    expect(body.title).toBe("THRIVE-DM — Type 2 Diabetes");
    expect(body.eligibility.minAgeYears).toBe(18);
    expect(body.contacts[0].phone).toBe("617-555-0100");
    // ...and stops gracefully degraded to [].
    expect(body.stops).toEqual([]);
  });

  it("returns 200 with stops: [] when MBTA responds non-OK", async () => {
    const nct = uniqueNct();
    const site = uniqueSite();
    mockFetchRouted({ studies: [siteStudy(nct, site.lat, site.lon)], totalCount: 1 }, async () =>
      new Response("rate limited", { status: 429 }),
    );
    const res = await GET(makeRequest(nct), makeContext(nct));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stops).toEqual([]);
  });
});
