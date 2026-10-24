import type { Eligibility, FitQuestion, Sex } from "./types";

export type Answer = "yes" | "no" | "unsure";

export interface Profile {
  age?: number;
  sex?: Exclude<Sex, "ALL">;
  healthy?: boolean; // true = no health condition (healthy volunteer)
}

export type FitOutcome = "possible-fit" | "ask-team";

export interface FitReason {
  kind:
    | "age-too-young"
    | "age-too-old"
    | "sex"
    | "healthy-volunteer"
    | "answer"
    // No questions to ask, so the free-text rules were never checked. These two come from the
    // study's data, not the person's answers, and must never read as a possible fit:
    | "insufficient-info" // the study gave no usable criteria text
    | "unchecked-criteria"; // the study has rules, but no questions were made from them
  questionId?: string;
}

// The reasons that describe missing study information rather than an answer.
export const INFO_REASONS: readonly FitReason["kind"][] = ["insufficient-info", "unchecked-criteria"];

// Criteria text counts as real content when it has at least one letter or digit in any script.
// Empty, whitespace-only and symbols-only text (and a missing value) have none.
export function hasCriteriaContent(criteriaText: unknown): boolean {
  return typeof criteriaText === "string" && /[\p{L}\p{N}]/u.test(criteriaText);
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

  // Cautious fallback (docs/TASKS.md, fit-check Requirement 7): with no generated questions,
  // age, sex and condition alone never produce "possible fit". The structured checks still
  // run and still report their own reasons. Which info reason depends on the criteria text:
  // none (empty, whitespace or symbols only) vs rules that were not turned into questions
  // (the model failed, timed out or returned none).
  if (questions.length === 0) {
    reasons.push({
      kind: hasCriteriaContent(eligibility.criteriaText) ? "unchecked-criteria" : "insufficient-info",
    });
  }

  return { outcome: reasons.length ? "ask-team" : "possible-fit", reasons };
}
