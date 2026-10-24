import { haversineMi } from "../geo";
import type { TrialDetail, TrialsResponse } from "../types";
import { mockTrials } from "./data";

// The search behind ?mock=1 (and TRIALPATH_MOCK=1). The live search hands the words to
// ClinicalTrials.gov, which matches them to condition terms in any order, so "type 2 diabetes"
// finds a study listed as "Diabetes Mellitus, Type 2". The fixtures keep the registry's own
// wording, so the mock normalizes the matching instead of changing that data: a title or
// condition matches when it contains the search as typed (the old rule), or contains every
// word of the search in any order, ignoring case and punctuation.

// Lowercase runs of letters or digits in any script: "Diabetes Mellitus, Type 2" gives
// diabetes, mellitus, type, 2.
function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function matchesCondition(
  trial: Pick<TrialDetail, "title" | "conditions">,
  cond: string,
): boolean {
  const fields = [...trial.conditions, trial.title];
  const term = cond.toLowerCase();
  if (fields.some((field) => field.toLowerCase().includes(term))) return true;
  const wanted = words(cond);
  // All words must be in the same field, so "type 2" and "diabetes" can't come from two
  // different conditions (for example "Diabetes Type 1" and "Obesity Class 2").
  return (
    wanted.length > 0 &&
    fields.some((field) => {
      const have = new Set(words(field));
      return wanted.every((word) => have.has(word));
    })
  );
}

// Same shape as GET /api/trials: within the radius of the search point, nearest first.
export function searchMockTrials(q: {
  cond: string;
  lat: number;
  lon: number;
  radius: number;
}): TrialsResponse {
  const trials = mockTrials
    .map((t) => ({
      ...t,
      distanceMi: haversineMi(q.lat, q.lon, t.nearestSite.lat, t.nearestSite.lon),
    }))
    .filter((t) => t.distanceMi <= q.radius && matchesCondition(t, q.cond))
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
