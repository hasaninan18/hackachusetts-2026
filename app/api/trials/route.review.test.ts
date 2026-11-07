// Tests for the PR #33 review follow-ups on GET /api/trials (live path): the server-side
// radius clamp, stopping on any repeated page token, and sharing one upstream fetch
// between identical concurrent searches. Only `fetch` is mocked; each test uses its own
// `cond` so the URL-keyed cache in lib/cache.ts never serves another test's result.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CtgStudiesResponse, CtgStudy } from "../../../lib/api-types";
import { MAX_RADIUS_MI } from "../../../lib/clinicaltrials";
import { GET } from "./route";

const DORCHESTER = { lat: 42.3016, lon: -71.0676 };

/** A recruiting MA study with one site at a real point `dLat` degrees north of Dorchester. */
function study(nctId: string, dLat = 0.01): CtgStudy {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: `Study ${nctId}` },
      contactsLocationsModule: {
        locations: [
          {
            facility: `Clinic ${nctId}`,
            city: "Boston",
            state: "Massachusetts",
            status: "RECRUITING",
            geoPoint: { lat: DORCHESTER.lat + dLat, lon: DORCHESTER.lon },
          },
        ],
      },
    },
  };
}

/** Serve pages keyed by the `pageToken` query param ("" = first page). */
function mockPages(pages: Record<string, CtgStudiesResponse>) {
  const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
    const page = pages[new URL(String(url)).searchParams.get("pageToken") ?? ""];
    if (!page) return new Response("no such page", { status: 400 });
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function search(cond: string, radius = "10"): Promise<Response> {
  const qs = new URLSearchParams({
    cond,
    lat: String(DORCHESTER.lat),
    lon: String(DORCHESTER.lon),
    radius,
  });
  return GET(new Request(`http://localhost:3000/api/trials?${qs}`));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/trials — review follow-ups", () => {
  it("clamps a hand-made huge radius to MAX_RADIUS_MI, upstream and in the radius filter", async () => {
    // 0.6° north ≈ 41 mi (inside 50); 0.8° north ≈ 55 mi (outside 50, inside 200).
    const fetchMock = mockPages({
      "": { studies: [study("NCT00000061", 0.6), study("NCT00000062", 0.8)] },
    });

    const body = await (await search("review-radius", "200")).json();

    const geo = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("filter.geo");
    expect(geo).toBe(`distance(${DORCHESTER.lat},${DORCHESTER.lon},${MAX_RADIUS_MI}mi)`);
    expect(body.trials.map((t: { nctId: string }) => t.nctId)).toEqual(["NCT00000061"]);
    expect(body.total).toBe(1);
  });

  it("stops on an A→B→A token loop without marking the result truncated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = mockPages({
      "": { studies: [study("NCT00000071")], nextPageToken: "A" },
      A: { studies: [study("NCT00000072")], nextPageToken: "B" },
      B: { studies: [study("NCT00000073")], nextPageToken: "A" },
    });

    const body = await (await search("review-loop")).json();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(body.total).toBe(3);
    expect(body.truncated).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("shares one upstream fetch between identical concurrent cold searches", async () => {
    const fetchMock = mockPages({
      "": { studies: [study("NCT00000081")], nextPageToken: "p2" },
      p2: { studies: [study("NCT00000082")] },
    });

    const [a, b, c] = await Promise.all([
      search("review-coalesce"),
      search("review-coalesce"),
      search("review-coalesce"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2); // two pages, once
    const bodies = await Promise.all([a.json(), b.json(), c.json()]);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[0].total).toBe(2);
  });
});
