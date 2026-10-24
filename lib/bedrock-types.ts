// Pure type contracts for the simplify pipeline (spec: simplify) — SDK-FREE.
//
// These interfaces describe the INTERNAL model shape the LLM is asked to produce and the
// HTTP success body. They live in their own module (no AWS SDK import) so that pure,
// server-and-test-only helpers (lib/bedrock-age.ts, lib/simplify-semantics.ts) can depend
// on the shapes WITHOUT pulling @aws-sdk/client-bedrock-runtime into their dependency
// graph. lib/bedrock.ts re-exports every type below, so existing imports are unaffected.
import type { Lang } from "./types";

/** One generated yes/no screening question. */
export interface SimplifyQuestion {
  id: string;
  text: string;
  ruleOutIf: "yes" | "no";
  source_criterion: string;
  kind: "inclusion" | "exclusion";
}

/** The internal model the LLM produces (richer than the frontend contract). */
export interface SimplifyModel {
  summary: string;
  whatYouDo: string;
  timeCommitment: string;
  questions: SimplifyQuestion[];
  staff_checks: string[];
}

/** The HTTP success body: SimplifyModel + the fields lib/simplify.ts#parseSimplified reads. */
export interface SimplifyBody extends SimplifyModel {
  lang: Lang;
  whatItStudies: string; // mirror of summary — parseSimplified reads whatItStudies || summary
}
