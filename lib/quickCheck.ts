import type { Eligibility, FitQuestion, Sex } from "./types";

export type Answer = "yes" | "no" | "unsure";

export interface Profile {
  age?: number;
  sex?: Exclude<Sex, "ALL">;
  healthy?: boolean; // true = no health condition (healthy volunteer)
}

export type FitOutcome = "possible-fit" | "ask-team";

export interface FitReason {
  kind: "age-too-young" | "age-too-old" | "sex" | "healthy-volunteer" | "answer";
  questionId?: string;
}

export interface FitResult {
  outcome: FitOutcome;
  reasons: FitReason[];
}

// Never decides eligibility: the only outcomes are "possible-fit" and "ask-team".
// Missing profile fields and "unsure" answers never rule anyone out.
export function quickCheck(
  profile: Profile,
  eligibility: Eligibility,
  questions: FitQuestion[],
  answers: Record<string, Answer>,
): FitResult {
  const reasons: FitReason[] = [];

  if (profile.age !== undefined && Number.isFinite(profile.age)) {
    if (eligibility.minAgeYears !== null && profile.age < eligibility.minAgeYears) {
      reasons.push({ kind: "age-too-young" });
    }
    if (eligibility.maxAgeYears !== null && profile.age > eligibility.maxAgeYears) {
      reasons.push({ kind: "age-too-old" });
    }
  }

  if (profile.sex && eligibility.sex !== "ALL" && profile.sex !== eligibility.sex) {
    reasons.push({ kind: "sex" });
  }

  // A study that only accepts people with the condition can't take healthy volunteers;
  // the reverse (healthyVolunteers: true) accepts both, so it never rules anyone out.
  if (profile.healthy === true && !eligibility.healthyVolunteers) {
    reasons.push({ kind: "healthy-volunteer" });
  }

  for (const q of questions) {
    if (answers[q.id] === q.ruleOutIf) reasons.push({ kind: "answer", questionId: q.id });
  }

  return { outcome: reasons.length ? "ask-team" : "possible-fit", reasons };
}
