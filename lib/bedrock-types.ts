// Pure type contracts for the simplify pipeline (spec: simplify) — SDK-FREE.
//
// These interfaces describe the INTERNAL model shape the LLM is asked to produce and the
// HTTP success body. They live in their own module (no AWS SDK import) so that pure,
// server-and-test-only helpers (lib/bedrock-age.ts, lib/simplify-semantics.ts,
// lib/simplify-mappings.ts) can depend on the shapes WITHOUT pulling
// @aws-sdk/client-bedrock-runtime into their dependency graph. lib/bedrock.ts re-exports
// every type below, so existing imports are unaffected.
import type { Lang } from "./types";
/**
 * One yes/no screening question.
 *
 * IMPORTANT (default-deny redesign): questions are now CONSTRUCTED BY THE SERVER from the
 * deterministic mapping registry (lib/simplify-mappings.ts). The model does NOT author
 * `text`, `ruleOutIf`, `kind`, or `source_criterion` for questions anymore — every one of
 * those fields comes from a supported mapping, not from model output.
 */
export interface SimplifyQuestion {
  id: string;
  text: string;
  ruleOutIf: "yes" | "no";
  source_criterion: string;
  kind: "inclusion" | "exclusion";
}
/**
 * The PROSE the LLM is asked to produce. Under design (a) the model authors ONLY the
 * human-readable prose (summary / whatYouDo / timeCommitment / staff_checks). It never
 * authors the checklist questions or their rule-out logic.
 */
export interface SimplifyProse {
  summary: string;
  whatYouDo: string;
  timeCommitment: string;
  staff_checks: string[];
}
/**
 * The internal model = server-built questions + model-authored prose. This is what the rest
 * of the pipeline shapes into the HTTP body. Questions are authoritative and server-owned.
 */
export interface SimplifyModel extends SimplifyProse {
  questions: SimplifyQuestion[];
}
/** The HTTP success body: SimplifyModel + the fields lib/simplify.ts#parseSimplified reads. */
export interface SimplifyBody extends SimplifyModel {
  lang: Lang;
  whatItStudies: string; // mirror of summary — parseSimplified reads whatItStudies || summary
}
