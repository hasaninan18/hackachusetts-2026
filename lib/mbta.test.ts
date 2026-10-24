// Tests for lib/mbta.ts (spec: getting-there).
//
// Pure helpers (milesToMbtaDegrees, parseWheelchair, toRouteType, stopFromRaw, rankStops)
// run for real — no network. The ONLY network touch is fetchNearbyStops' fetch, which is
// stubbed with vi.stubGlobal: NO live MBTA calls in the suite.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStopsUrl,
  fetchNearbyStops,
  milesToMbtaDegrees,
  parseWheelchair,
  rankStops,
  stopFromRaw,
  toRouteType,
  type MbtaStop,
  type MbtaStopsResponse,
} from "./mbta";

// BMC corrected coordinates (docs/DEMO_DATA.md, lib/facilities.ts).
const BMC = { lat: 42.335, lon: -71.0728 };

/** Build a raw MBTA stop with sensible defaults, overridable per field. */
function rawStop(over: {
  id?: string;
  name?: string;
  lat?: number;
  lon?: number;
  vehicle_type?: number;
  wheelchair_boarding?: number;
  parentId?: string | null;
}): MbtaStop {
  return {
    id: over.id ?? "0",
    attributes: {
      name: over.name,
      latitude: over.lat,
      longitude: over.lon,
      vehicle_type: over.vehicle_type,
      wheelchair_boarding: over.wheelchair_boarding,
    },
    relationships: {
      parent_station: { data: over.parentId === undefined ? null : over.parentId === null ? null : { id: over.parentId } },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// milesToMbtaDegrees — the single unit boundary.
// ---------------------------------------------------------------------------
describe("milesToMbtaDegrees", () => {
  it("is monotonic and non-negative", () => {
    const a = milesToMbtaDegrees(0.1);
    const b = milesToMbtaDegrees(0.7);
    const c = milesToMbtaDegrees(2);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
  it("maps ~0.7 mi to ~0.01 degrees", () => {
    expect(milesToMbtaDegrees(0.7)).toBeCloseTo(0.01, 4);
  });
  it("falls back to a small positive floor for zero/negative/non-finite input", () => {
    expect(milesToMbtaDegrees(0)).toBeGreaterThan(0);
    expect(milesToMbtaDegrees(-5)).toBeGreaterThan(0);
    expect(milesToMbtaDegrees(NaN)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildStopsUrl — probe-verified params.
// ---------------------------------------------------------------------------
describe("buildStopsUrl", () => {
  it("includes location_type=0,1, route_type=0,1,2,3, an explicit page[limit], and sort=distance", () => {
    const url = new URL(buildStopsUrl({ lat: BMC.lat, lon: BMC.lon }));
    expect(url.origin + url.pathname).toBe("https://api-v3.mbta.com/stops");
    expect(url.searchParams.get("filter[latitude]")).toBe(String(BMC.lat));
    expect(url.searchParams.get("filter[longitude]")).toBe(String(BMC.lon));
    expect(url.searchParams.get("filter[location_type]")).toBe("0,1");
    expect(url.searchParams.get("filter[route_type]")).toBe("0,1,2,3");
    expect(url.searchParams.get("sort")).toBe("distance");
    expect(Number(url.searchParams.get("page[limit]"))).toBeGreaterThan(0);
    expect(Number(url.searchParams.get("filter[radius]"))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parseWheelchair — accessibility honesty (Requirement 4).
// ---------------------------------------------------------------------------
describe("parseWheelchair", () => {
  it("maps 1 -> true (accessible)", () => {
    expect(parseWheelchair(1)).toBe(true);
  });
  it("maps 2 -> false (not accessible)", () => {
    expect(parseWheelchair(2)).toBe(false);
  });
  it("maps 0 -> null (unknown), never true", () => {
    expect(parseWheelchair(0)).toBeNull();
  });
  it("maps missing/undefined -> null (unknown), never true", () => {
    expect(parseWheelchair(undefined)).toBeNull();
  });
  it("maps junk numbers -> null, never true", () => {
    expect(parseWheelchair(9)).toBeNull();
    expect(parseWheelchair(-1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toRouteType.
// ---------------------------------------------------------------------------
describe("toRouteType", () => {
  it("accepts 0..3", () => {
    expect(toRouteType(0)).toBe(0);
    expect(toRouteType(1)).toBe(1);
    expect(toRouteType(2)).toBe(2);
    expect(toRouteType(3)).toBe(3);
  });
  it("rejects out-of-range / missing values", () => {
    expect(toRouteType(4)).toBeNull();
    expect(toRouteType(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stopFromRaw — parsing one stop.
// ---------------------------------------------------------------------------
describe("stopFromRaw", () => {
  it("maps a valid bus stop with lines:[] and a finite walkMi", () => {
    const stop = stopFromRaw(
      rawStop({ id: "5089", name: "91 E Concord St", lat: 42.33556, lon: -71.072264, vehicle_type: 3, wheelchair_boarding: 1 }),
      BMC,
    );
    expect(stop).not.toBeNull();
    expect(stop!.id).toBe("5089");
    expect(stop!.name).toBe("91 E Concord St");
    expect(stop!.routeType).toBe(3);
    expect(stop!.lines).toEqual([]);
    expect(stop!.wheelchair).toBe(true);
    expect(stop!.walkMi).toBeGreaterThan(0);
    expect(Number.isFinite(stop!.walkMi)).toBe(true);
  });
  it("prefers the parent_station id for Stop.id", () => {
    const stop = stopFromRaw(
      rawStop({ id: "70073", name: "Charles/MGH", lat: 42.3612, lon: -71.0707, vehicle_type: 1, wheelchair_boarding: 1, parentId: "place-chmnl" }),
      BMC,
    );
    expect(stop!.id).toBe("place-chmnl");
  });
  it("returns null for a blank name", () => {
    expect(stopFromRaw(rawStop({ name: "", lat: 42.3, lon: -71.0, vehicle_type: 3 }), BMC)).toBeNull();
  });
  it("returns null for non-finite coordinates", () => {
    expect(stopFromRaw(rawStop({ name: "X", lat: NaN, lon: -71.0, vehicle_type: 3 }), BMC)).toBeNull();
  });
  it("returns null for an unusable vehicle_type", () => {
    expect(stopFromRaw(rawStop({ name: "X", lat: 42.3, lon: -71.0, vehicle_type: 99 }), BMC)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rankStops — de-dup, order, cap (Requirement 3).
// ---------------------------------------------------------------------------
describe("rankStops", () => {
  it("sorts by walking distance ascending and caps at 3", () => {
    // Deliberately out of order; farther stops listed first.
    const raw: MbtaStop[] = [
      rawStop({ id: "far", name: "Far", lat: 42.345, lon: -71.082, vehicle_type: 3, wheelchair_boarding: 1 }),
      rawStop({ id: "mid", name: "Mid", lat: 42.339, lon: -71.075, vehicle_type: 3, wheelchair_boarding: 1 }),
      rawStop({ id: "near", name: "Near", lat: 42.3351, lon: -71.0729, vehicle_type: 3, wheelchair_boarding: 1 }),
      rawStop({ id: "extra", name: "Extra", lat: 42.350, lon: -71.090, vehicle_type: 3, wheelchair_boarding: 1 }),
    ];
    const ranked = rankStops(raw, BMC);
    expect(ranked).toHaveLength(3);
    expect(ranked.map((s) => s.name)).toEqual(["Near", "Mid", "Far"]);
    expect(ranked[0].walkMi).toBeLessThan(ranked[1].walkMi);
    expect(ranked[1].walkMi).toBeLessThan(ranked[2].walkMi);
  });
  it("de-dups by name, keeping the nearest instance (rail platforms repeat)", () => {
    const raw: MbtaStop[] = [
      // Same name twice (two Charles/MGH platforms); the first is farther.
      rawStop({ id: "70074", name: "Charles/MGH", lat: 42.340, lon: -71.078, vehicle_type: 1, wheelchair_boarding: 1, parentId: "place-chmnl" }),
      rawStop({ id: "70073", name: "Charles/MGH", lat: 42.3352, lon: -71.0729, vehicle_type: 1, wheelchair_boarding: 1, parentId: "place-chmnl" }),
    ];
    const ranked = rankStops(raw, BMC);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].name).toBe("Charles/MGH");
    // Nearest instance kept: the second platform is closer to BMC.
    expect(ranked[0].walkMi).toBeLessThan(0.3);
  });
  it("skips malformed entries and returns [] when none are usable", () => {
    const raw: MbtaStop[] = [
      rawStop({ name: "", lat: 42.3, lon: -71.0, vehicle_type: 3 }),
      rawStop({ name: "Bad coords", lat: NaN, lon: -71.0, vehicle_type: 3 }),
      { },
    ];
    expect(rankStops(raw, BMC)).toEqual([]);
  });
  it("returns [] for non-array input", () => {
    expect(rankStops(undefined, BMC)).toEqual([]);
  });
  it("preserves wheelchair tri-state end to end (1/2/0)", () => {
    const raw: MbtaStop[] = [
      rawStop({ id: "a", name: "A", lat: 42.3351, lon: -71.0729, vehicle_type: 0, wheelchair_boarding: 1 }),
      rawStop({ id: "b", name: "B", lat: 42.336, lon: -71.074, vehicle_type: 0, wheelchair_boarding: 2 }),
      rawStop({ id: "c", name: "C", lat: 42.337, lon: -71.075, vehicle_type: 0, wheelchair_boarding: 0 }),
    ];
    const ranked = rankStops(raw, BMC);
    const byName = Object.fromEntries(ranked.map((s) => [s.name, s.wheelchair]));
    expect(byName["A"]).toBe(true);
    expect(byName["B"]).toBe(false);
    expect(byName["C"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchNearbyStops — I/O: never rejects, degrades to [] (Requirements 6, 7).
// ---------------------------------------------------------------------------
describe("fetchNearbyStops", () => {
  // Unique coords per test so the URL-keyed cache never serves a prior test's result.
  let n = 0;
  const uniqueOrigin = () => ({ lat: 42.335 + n * 1e-4, lon: -71.0728 - n++ * 1e-4 });

  function mockOk(body: MbtaStopsResponse) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/vnd.api+json" } })),
    );
  }

  it("returns parsed, ranked stops on a successful response", async () => {
    const origin = uniqueOrigin();
    mockOk({
      data: [
        rawStop({ id: "5089", name: "91 E Concord St", lat: origin.lat + 1e-4, lon: origin.lon, vehicle_type: 3, wheelchair_boarding: 1 }),
        rawStop({ id: "10014", name: "Albany St opp Boston Medical", lat: origin.lat - 1e-3, lon: origin.lon, vehicle_type: 3, wheelchair_boarding: 1 }),
      ],
    });
    const stops = await fetchNearbyStops(origin);
    expect(stops).toHaveLength(2);
    expect(stops[0].name).toBe("91 E Concord St");
    expect(stops[0].wheelchair).toBe(true);
    expect(stops[0].lines).toEqual([]);
  });

  it("resolves [] (never rejects) when the fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await expect(fetchNearbyStops(uniqueOrigin())).resolves.toEqual([]);
  });

  it("resolves [] on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(fetchNearbyStops(uniqueOrigin())).resolves.toEqual([]);
  });

  it("resolves [] on a timeout/abort", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(fetchNearbyStops(uniqueOrigin())).resolves.toEqual([]);
  });

  it("resolves [] on a malformed body (no data array)", async () => {
    mockOk({} as MbtaStopsResponse);
    await expect(fetchNearbyStops(uniqueOrigin())).resolves.toEqual([]);
  });

  it("resolves [] without fetching for non-finite origin coordinates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchNearbyStops({ lat: NaN, lon: -71 })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
