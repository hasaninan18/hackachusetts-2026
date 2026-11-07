// Tests for the live-search paging helpers in lib/clinicaltrials.ts: buildSearchUrl's
// page size / page token, and summarizeSearch (dedupe → slim → radius → rank → trim).

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CtgStudy } from "./api-types";
import {
  LIVE_PAGE_SIZE,
  RESULT_LIMIT,
  buildSearchUrl,
  summarizeSearch,
} from "./clinicaltrials";

const ORIGIN = { lat: 42.3016, lon: -71.0676 };

/** A recruiting MA study with one site at a real point `dLat` degrees north of ORIGIN. */
function study(nctId: string, dLat: number): CtgStudy {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: nctId },
      contactsLocationsModule: {
        locations: [
          {
            facility: `Clinic ${nctId}`,
            city: "Boston",
            state: "Massachusetts",
            status: "RECRUITING",
            geoPoint: { lat: ORIGIN.lat + dLat, lon: ORIGIN.lon },
          },
        ],
      },
    },
  };
}

describe("buildSearchUrl — paging", () => {
  it("asks for LIVE_PAGE_SIZE studies, within the API maximum of 1000", () => {
    const url = new URL(buildSearchUrl({ cond: "asthma", lat: 42.3, lon: -71.06, radius: 10 }));
    expect(url.searchParams.get("pageSize")).toBe(String(LIVE_PAGE_SIZE));
    expect(LIVE_PAGE_SIZE).toBeLessThanOrEqual(1000);
    expect(url.searchParams.has("pageToken")).toBe(false);
  });

  it("adds pageToken only when one is given, keeping the rest of the search", () => {
    const base = { cond: "asthma", lat: 42.3, lon: -71.06, radius: 10 };
    const first = new URL(buildSearchUrl(base));
    const next = new URL(buildSearchUrl({ ...base, pageToken: "abc+/=" }));
    expect(next.searchParams.get("pageToken")).toBe("abc+/=");
    next.searchParams.delete("pageToken");
    expect(next.toString()).toBe(first.toString());
    expect(new URL(buildSearchUrl({ ...base, pageToken: "" })).searchParams.has("pageToken")).toBe(
      false,
    );
  });
});

describe("summarizeSearch", () => {
  it("drops out-of-radius studies and counts only in-radius ones", () => {
    // 0.01° ≈ 0.7 mi (in 5 mi); 0.5° ≈ 35 mi (out).
    const out = summarizeSearch([study("NCT1", 0.01), study("NCT2", 0.5)], ORIGIN, 5);
    expect(out.trials.map((t) => t.nctId)).toEqual(["NCT1"]);
    expect(out.total).toBe(1);
    expect(out.truncated).toBeUndefined();
  });

  it("sets truncated only when asked", () => {
    expect(summarizeSearch([], ORIGIN, 5, { truncated: true })).toEqual({
      trials: [],
      total: 0,
      truncated: true,
    });
  });

  it("returns at most RESULT_LIMIT by default", () => {
    const many = Array.from({ length: RESULT_LIMIT + 5 }, (_, i) => study(`NCT${i}`, 0.0001 * i));
    const out = summarizeSearch(many, ORIGIN, 5);
    expect(out.trials).toHaveLength(RESULT_LIMIT);
    expect(out.total).toBe(RESULT_LIMIT + 5);
  });

  it("property: keeps the nearest `limit` unique in-radius trials, sorted, with total ≥ shown", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 30 }),
            dLat: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
          }),
          { maxLength: 60 },
        ),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 5, max: 25 }),
        (rows, limit, radius) => {
          const studies = rows.map((r) => study(`NCT${r.id}`, r.dLat));
          const out = summarizeSearch(studies, ORIGIN, radius, { limit });
          const shownIds = out.trials.map((t) => t.nctId);

          // Unique NCT IDs (the results list is keyed by them).
          expect(new Set(shownIds).size).toBe(shownIds.length);
          // total counts unique in-radius studies; the list is the first `limit` of them.
          expect(out.total).toBeLessThanOrEqual(new Set(rows.map((r) => r.id)).size);
          expect(out.trials.length).toBe(Math.min(limit, out.total));
          // Sorted nearest-first and inside the radius.
          for (let i = 0; i < out.trials.length; i++) {
            expect(out.trials[i].distanceMi).toBeLessThanOrEqual(radius);
            if (i > 0) {
              expect(out.trials[i].distanceMi).toBeGreaterThanOrEqual(out.trials[i - 1].distanceMi);
            }
          }
          // Trimming never drops a nearer trial than one it keeps.
          const full = summarizeSearch(studies, ORIGIN, radius, { limit: Number.MAX_SAFE_INTEGER });
          expect(full.total).toBe(out.total);
          expect(full.trials.slice(0, out.trials.length)).toEqual(out.trials);
        },
      ),
    );
  });
});
