// Pure, SDK-FREE structured-age helpers for the simplify pipeline (spec: simplify).
//
// These functions decide whether a question's `source_criterion` is a citation of the
// study's STRUCTURED age bounds (minimumAge/maximumAge) rather than a free-text quote, and
// parse such a citation into a (field, value) pair that can be checked against the study's
// ACTUAL bounds. They live in their own module (no AWS SDK import) so both lib/bedrock.ts
// (the SDK transport + orchestrator) and lib/simplify-semantics.ts (the pure semantic
// authority) can share ONE implementation without dragging @aws-sdk into a non-SDK bundle
// or a test's dependency graph. lib/bedrock.ts re-exports every symbol below, so existing
// imports from "./bedrock" are unaffected.

/** Normalize text for substring comparison: collapse whitespace, lower-case, trim. */
export function normalizeForQuoteMatch(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Markers that signal a source_criterion is derived from the STRUCTURED age bounds
 * (minimumAge/maximumAge) rather than quoted free text. When a question's source_criterion
 * references these structured fields it is validated against the structured VALUES of the
 * study (see validateStructuredAgeCitation in lib/bedrock.ts), NOT required to appear
 * verbatim in the free-text criteria block.
 */
const STRUCTURED_AGE_MARKERS = [
  "minimumage",
  "maximumage",
  "minimum age",
  "maximum age",
  "structured age",
  "age bound",
  "age bounds",
];

/** True if a source_criterion is referencing the structured age fields. */
export function isStructuredAgeCriterion(sourceCriterion: string): boolean {
  const n = normalizeForQuoteMatch(sourceCriterion);
  return STRUCTURED_AGE_MARKERS.some((m) => n.includes(m));
}

/** Which structured age bound a citation names. */
export type AgeBoundField = "min" | "max";

export interface StructuredAgeCitation {
  field: AgeBoundField;
  value: number;
}

/** Tolerance (years) allowed ONLY when a cited or actual age is non-integer. */
export const AGE_MATCH_TOLERANCE_YEARS = 0.1;

/**
 * Parse a structured-age source_criterion into the CITED field (min vs max) and the CITED
 * numeric age VALUE, or null if neither can be extracted. Field detection prefers explicit
 * "minimum"/"maximum" (or "minAge"/"maxAge") wording; the value is the first number in the
 * string. This is the data we validate against the study's ACTUAL bounds -- merely looking
 * like an age citation is NOT enough.
 */
export function parseStructuredAgeCitation(
  sourceCriterion: string,
): StructuredAgeCitation | null {
  const n = normalizeForQuoteMatch(sourceCriterion);
  const mentionsMin = /\bmin(?:imum)?\s*age\b|\bminimumage\b/.test(n);
  const mentionsMax = /\bmax(?:imum)?\s*age\b|\bmaximumage\b/.test(n);
  let field: AgeBoundField | null = null;
  // If exactly one of the two is named, that is the cited field. If BOTH are named we
  // cannot attribute the one number to one field, so the citation is ambiguous and
  // unparseable -- reject it.
  if (mentionsMin && !mentionsMax) field = "min";
  else if (mentionsMax && !mentionsMin) field = "max";
  if (field === null) return null;
  // Extract the first numeric value (supports integers and decimals, e.g. "0.5 years").
  const numMatch = n.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const value = Number(numMatch[1]);
  if (!Number.isFinite(value)) return null;
  return { field, value };
}
