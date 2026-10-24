import "server-only";
import { headers } from "next/headers";
import { haversineMi } from "./geo";
import { parseOutcomes, type TrialDetailWithOutcomes } from "./outcomes";
import { getMockTrial, mockTrials } from "./mock/data";
import type { Eligibility, Site, TrialSummary, TrialsResponse } from "./types";

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
  const body = await res.json();
  const trials = (Array.isArray(body?.trials) ? body.trials : []).filter(isSummary);
  return { trials, total: typeof body?.total === "number" ? body.total : trials.length };
}

// Responses are checked before rendering: a missing array must not crash the page
// (components map over stops/contacts/conditions directly).
function isSite(s: unknown): s is Site {
  const v = s as Site;
  return !!v && typeof v.name === "string" && Number.isFinite(v.lat) && Number.isFinite(v.lon);
}

function isSummary(t: unknown): t is TrialSummary {
  const v = t as TrialSummary;
  return (
    !!v &&
    typeof v.nctId === "string" &&
    typeof v.title === "string" &&
    isSite(v.nearestSite) &&
    Number.isFinite(v.distanceMi)
  );
}

function toDetail(body: unknown): TrialDetailWithOutcomes {
  if (!isSummary(body)) throw new Error("Malformed trial response");
  const v = body as Partial<TrialDetailWithOutcomes> & TrialSummary;
  const e = (v.eligibility ?? {}) as Partial<Eligibility>;
  return {
    ...v,
    outcomes: parseOutcomes(v.outcomes, v.nctId),
    conditions: Array.isArray(v.conditions) ? v.conditions : [],
    phase: typeof v.phase === "string" ? v.phase : null,
    nearestSite: { ...v.nearestSite, locationPrecision: v.nearestSite.locationPrecision ?? "city" },
    briefSummary: typeof v.briefSummary === "string" ? v.briefSummary : "",
    eligibility: {
      minAgeYears: Number.isFinite(e.minAgeYears) ? (e.minAgeYears as number) : null,
      maxAgeYears: Number.isFinite(e.maxAgeYears) ? (e.maxAgeYears as number) : null,
      sex: e.sex === "FEMALE" || e.sex === "MALE" ? e.sex : "ALL",
      healthyVolunteers: e.healthyVolunteers === true,
      criteriaText: typeof e.criteriaText === "string" ? e.criteriaText : "",
    },
    sites: Array.isArray(v.sites) ? v.sites.filter(isSite) : [],
    contacts: Array.isArray(v.contacts) ? v.contacts : [],
    stops: Array.isArray(v.stops)
      ? v.stops.filter((s) => s && typeof s.name === "string" && Number.isFinite(s.walkMi))
          .map((s) => ({ ...s, lines: Array.isArray(s.lines) ? s.lines : [] }))
      : [],
  };
}

export async function getTrial(nctId: string, mock: boolean): Promise<TrialDetailWithOutcomes | null> {
  if (mock) return getMockTrial(nctId) ?? null;
  const res = await fetch(`${await apiBase()}/api/trials/${encodeURIComponent(nctId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/trials/${nctId} ${res.status}`);
  return toDetail(await res.json());
}
