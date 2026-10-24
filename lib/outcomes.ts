import type { TrialDetail } from "./types";

// Frontend-only extension: keep the shared backend contract unchanged.
export type TrialDetailWithOutcomes = TrialDetail & { outcomes?: StudyOutcomes };

export type StudyOutcomes =
  | { status: "not_checked" | "unavailable" }
  | { status: "not_posted"; nctId: string; checkedOn: string }
  | {
      status: "available";
      nctId: string;
      postedOn: string; // ISO calendar date of the source results posting/update
      measures: OutcomeMeasure[];
      summary?: string; // Source-backed explanation in English; never a patient testimonial.
      limitations?: string;
    };

export interface OutcomeMeasure {
  title: string;
  timeFrame: string;
  statistic: string; // e.g. mean change, median, count; preserve the source's meaning.
  groups: {
    name: string;
    participants: number; // Number analyzed for THIS measure, not total enrollment.
    value: string;
    unit: string;
    uncertainty?: string; // Preserve the source label (e.g. 95% CI or SD) with its values.
  }[];
}


const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const optionalText = (v: unknown) => v === undefined || text(v);
const date = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
};

function measure(v: unknown): v is OutcomeMeasure {
  return record(v) && text(v.title) && text(v.timeFrame) && text(v.statistic) &&
    Array.isArray(v.groups) && v.groups.length > 0 && v.groups.every((g: unknown) =>
      record(g) && text(g.name) && Number.isSafeInteger(g.participants) &&
      (g.participants as number) >= 0 && text(g.value) && text(g.unit) && optionalText(g.uncertainty));
}

// Reject incomplete results as a whole. Dropping a comparison arm or its denominator
// could turn a valid statistic into a misleading claim. An absent integration is not
// evidence that a study has no results; only a successful source check can say that.
export function parseOutcomes(value: unknown, nctId: string): StudyOutcomes {
  if (value === undefined || value === null) return { status: "not_checked" };
  const unavailable: StudyOutcomes = { status: "unavailable" };
  if (!record(value)) return unavailable;
  if (value.status === "not_checked" || value.status === "unavailable") return { status: value.status };
  if (!/^NCT\d{8}$/.test(nctId) || value.nctId !== nctId) return unavailable;
  if (value.status === "not_posted" && date(value.checkedOn)) {
    return { status: "not_posted", nctId, checkedOn: value.checkedOn };
  }
  if (value.status !== "available" || !date(value.postedOn) ||
    !Array.isArray(value.measures) || value.measures.length === 0 || !value.measures.every(measure) ||
    !optionalText(value.summary) || !optionalText(value.limitations)) return unavailable;
  return {
    status: "available", nctId, postedOn: value.postedOn,
    measures: value.measures,
    summary: value.summary as string | undefined,
    limitations: value.limitations as string | undefined,
  };
}
