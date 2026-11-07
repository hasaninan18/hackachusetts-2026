// Tests for GET /api/trials paging through ClinicalTrials.gov (live path).
//
// The live search used to ask for one page of 50 studies and never follow `nextPageToken`,
// so results silently stopped at 50 studies before the MA-site and radius filters ran.
// Only `fetch` is mocked; lib/clinicaltrials.ts runs for real. Each test uses its own
// `cond` so the URL-keyed cache in lib/cache.ts never serves another test's result.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CtgStudiesResponse, CtgStudy } from "../../../lib/api-types";
import { LIVE_MAX_PAGES, LIVE_PAGE_SIZE, RESULT_LIMIT } from "../../../lib/clinicaltrials";
import { GET } from "./route";

/** Dorchester reference origin (docs/DEMO_DATA.md). */
const DORCHESTER = { lat: 42.3016, lon: -71.0676 };

/** A recruiting MA study with one site at a real (non-centroid) point `dLat` degrees north. */
function study(nctId: string, dLat = 0.01): CtgStudy {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: `Study ${nctId}` },
      conditionsModule: { conditions: ["Diabetes"] },
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

function json(body: CtgStudiesResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Serve pages keyed by the `pageToken` query param ("" = first page). */
function mockPages(pages: Record<string, CtgStudiesResponse>) {
  const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
    const token = new URL(String(url)).searchParams.get("pageToken") ?? "";
    const page = pages[token];
    if (!page) return new Response("no such page", { status: 400 });
    return json(page);
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

const ids = (body: { trials: { nctId: string }[] }) => body.trials.map((t) => t.nctId).sort();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/trials — paging (live path)", () => {
  it("follows nextPageToken so studies on page 2 appear", async () => {
    const fetchMock = mockPages({
      "": { studies: [study("NCT00000001"), study("NCT00000002")], nextPageToken: "tok-2" },
      "tok-2": { studies: [study("NCT00000003")], nextPageToken: "tok-3" },
      "tok-3": { studies: [study("NCT00000004")] },
    });

    const res = await search("paging-basic");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ids(body)).toEqual(["NCT00000001", "NCT00000002", "NCT00000003", "NCT00000004"]);
    expect(body.total).toBe(4);
    expect(body.truncated).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((c) => new URL(String(c[0])));
    expect(urls.map((u) => u.searchParams.get("pageToken"))).toEqual([null, "tok-2", "tok-3"]);
    // Every page is the same search at the same page size.
    for (const u of urls) {
      expect(u.searchParams.get("pageSize")).toBe(String(LIVE_PAGE_SIZE));
      expect(u.searchParams.get("query.cond")).toBe("paging-basic");
    }
  });

  it("stops at LIVE_MAX_PAGES and marks the response truncated", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      return json({ studies: [study(`NCT9${String(n).padStart(7, "0")}`)], nextPageToken: `t${n}` });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await search("paging-cap");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(fetchMock).toHaveBeenCalledTimes(LIVE_MAX_PAGES);
    expect(body.total).toBe(LIVE_MAX_PAGES);
    expect(body.truncated).toBe(true);
  });

  it("stops if upstream repeats the same page token", async () => {
    const fetchMock = mockPages({
      "": { studies: [study("NCT00000011")], nextPageToken: "same" },
      same: { studies: [study("NCT00000012")], nextPageToken: "same" },
    });

    const body = await (await search("paging-repeat")).json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ids(body)).toEqual(["NCT00000011", "NCT00000012"]);
  });

  it("drops a study repeated across pages", async () => {
    mockPages({
      "": { studies: [study("NCT00000021"), study("NCT00000022")], nextPageToken: "p2" },
      p2: { studies: [study("NCT00000022"), study("NCT00000023")] },
    });

    const body = await (await search("paging-dupes")).json();

    expect(ids(body)).toEqual(["NCT00000021", "NCT00000022", "NCT00000023"]);
    expect(body.total).toBe(3);
  });

  it("returns the nearest RESULT_LIMIT trials and an honest total", async () => {
    const count = RESULT_LIMIT + 50;
    // Spread sites 0.0001°–0.025° north (all well inside 10 mi), listed far-to-near so the
    // trim must come from ranking, not upstream order. Split across two pages.
    const all = Array.from({ length: count }, (_, i) =>
      study(`NCT1${String(i).padStart(7, "0")}`, 0.0001 * (count - i)),
    );
    mockPages({
      "": { studies: all.slice(0, 120), nextPageToken: "p2" },
      p2: { studies: all.slice(120) },
    });

    const body = await (await search("paging-limit")).json();

    expect(body.total).toBe(count);
    expect(body.trials).toHaveLength(RESULT_LIMIT);
    const d = body.trials.map((t: { distanceMi: number }) => t.distanceMi);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
    // The nearest study (last in upstream order) is first; the 50 farthest were trimmed.
    expect(body.trials[0].nctId).toBe(`NCT1${String(count - 1).padStart(7, "0")}`);
    expect(ids(body)).not.toContain("NCT10000000");
  });

  it("returns 502 (not a partial list) when a later page fails", async () => {
    mockPages({
      "": { studies: [study("NCT00000031")], nextPageToken: "missing" },
    });

    const res = await search("paging-fail");

    expect(res.status).toBe(502);
  });

  it("uses one deadline for all pages: two 6 s pages end in a 504", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Each page answers after 6 s, under the 10 s limit on its own, unless aborted first.
    const fetchMock = vi.fn(
      (url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const token = new URL(String(url)).searchParams.get("pageToken");
          const timer = setTimeout(
            () =>
              resolve(
                json({
                  studies: [study(token ? "NCT00000042" : "NCT00000041")],
                  nextPageToken: token ? undefined : "p2",
                }),
              ),
            6_000,
          );
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = search("paging-deadline");
    await vi.advanceTimersByTimeAsync(12_000);
    const res = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(504);
  });

  it("serves a repeat search from the cache without refetching any page", async () => {
    const fetchMock = mockPages({
      "": { studies: [study("NCT00000051")], nextPageToken: "p2" },
      p2: { studies: [study("NCT00000052")] },
    });

    const first = await (await search("paging-cache")).json();
    const second = await (await search("paging-cache")).json();

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
