import "server-only";
import { headers } from "next/headers";
import { haversineMi } from "./geo";
import { getMockTrial, mockTrials } from "./mock/data";
import type { TrialDetail, TrialsResponse } from "./types";

// Pages talk to the backend only through the HTTP contract in lib/types.ts, so Hasan's
// route handlers can change internally without touching the UI.
// Mocks are used when ?mock=1 is on the URL or TRIALPATH_MOCK=1 is set (until the API lands).

export function wantsMocks(mockParam?: string | string[]): boolean {
  return mockParam === "1" || process.env.TRIALPATH_MOCK === "1";
}

async function apiBase(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export interface TrialQuery {
  cond: string;
  lat: number;
  lon: number;
  radius: number;
}

export async function getTrials(q: TrialQuery, mock: boolean): Promise<TrialsResponse> {
  if (mock) {
    const term = q.cond.toLowerCase();
    const trials = mockTrials
      .map((t) => ({
        ...t,
        distanceMi: haversineMi(q.lat, q.lon, t.nearestSite.lat, t.nearestSite.lon),
      }))
      .filter(
        (t) =>
          t.distanceMi <= q.radius &&
          (t.conditions.some((c) => c.toLowerCase().includes(term)) ||
            t.title.toLowerCase().includes(term)),
      )
      .sort((a, b) => a.distanceMi - b.distanceMi)
      .map(({ nctId, title, conditions, phase, nearestSite, distanceMi }) => ({
        nctId,
        title,
        conditions,
        phase,
        nearestSite,
        distanceMi,
      }));
    return { trials, total: trials.length };
  }

  const params = new URLSearchParams({
    cond: q.cond,
    lat: String(q.lat),
    lon: String(q.lon),
    radius: String(q.radius),
  });
  const res = await fetch(`${await apiBase()}/api/trials?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/trials ${res.status}`);
  return res.json();
}

export async function getTrial(nctId: string, mock: boolean): Promise<TrialDetail | null> {
  if (mock) return getMockTrial(nctId) ?? null;
  const res = await fetch(`${await apiBase()}/api/trials/${encodeURIComponent(nctId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/trials/${nctId} ${res.status}`);
  return res.json();
}
