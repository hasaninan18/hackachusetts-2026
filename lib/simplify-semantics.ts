// Semantic safety BACKSTOP for the simplify pipeline (spec: simplify) — SDK-FREE.
//
// WHY THIS MODULE EXISTS, AND HOW IT CHANGED (the default-deny redesign, then the final fix):
// Previously this module tried to VALIDATE whatever questions the MODEL wrote (default-allow).
// The redesign moved question construction to the SERVER (lib/simplify-mappings.ts); this
// module became a VERIFIER that the server's own constructed questions still agree with the
// mapping registry and the study's real registry facts.
//
// THE FINAL FIX: the verifier must gate free-text questions with the SAME rule construction
// uses — STUDY-PINNED, HASH-GATED, EXACT-LINE — so the backstop can never be weaker than
// construction. It no longer uses section.includes() SUBSTRING checks (which accepted an
// altered line that merely CONTAINED the reviewed substring). For every free-text question:
//   - detail.nctId (normalized) must equal the mapping's pinned nctId;
//   - the study's criteria-revision hash must equal the reviewed stored hash;
//   - the question's source_criterion must normalize to the mapping's exactLine; AND
//   - EXACTLY ONE line in the mapping's declared section must equal that exactLine
//     (normalizeLine ===), i.e. matchExactLine() returns a line equal to source_criterion.
//
// It keeps the structural guards the redesign requires as defense-in-depth: NEGATION of the
// question TEXT, AGE POLARITY + structured-age citation checks, STAFF-ONLY subject/evidence,
// UNKNOWN id, and FIXED kind/ruleOutIf/wording. It is pure + SDK-free (unit-tests without
// Bedrock, never drags in the AWS SDK).
import type { SimplifyModel, SimplifyQuestion } from "./bedrock-types";
import type { TrialDetail } from "./types";
import type { Lang } from "./types";
import {
  FREE_TEXT_MAPPINGS,
  AGE_MAPPINGS,
  hasQuestionWording,
  type WordingLang,
  norm as mapNorm,
  normalizeLine,
  splitSections,
  matchExactLine,
  criteriaRevisionHash,
  REVIEWED_CRITERIA_HASH,
  normNctId,
} from "./simplify-mappings";
import { isStructuredAgeCriterion, parseStructuredAgeCitation } from "./bedrock-age";

// ---------------------------------------------------------------------------
// Text normalization (shared spelling with the mapping registry).
// ---------------------------------------------------------------------------
/** Collapse whitespace, lower-case, trim — for robust keyword comparison. */
export const norm = mapNorm;

// ---------------------------------------------------------------------------
// (1) Section polarity of CITED EVIDENCE — delegated to the single heading authority.
// ---------------------------------------------------------------------------
// NOTE: evidencePolarity is NO LONGER used to GATE free-text questions (the exact-line rule
// does that). It is retained as a helper for diagnostics/tests and still resolves a quote to
// its section using the same explicit-heading splitter.
export type CriterionPolarity = "inclusion" | "exclusion" | "unknown";

/**
 * Determine the authoritative polarity of a quoted source_criterion by locating it in the
 * inclusion vs exclusion section of the criteria text, using the SAME explicit-heading
 * splitter the mapping registry uses. Returns "unknown" when the quote is not substantively
 * present in exactly one well-delimited section. (Diagnostic helper; non-gating.)
 */
export function evidencePolarity(
  sourceCriterion: string,
  criteriaText: string,
): CriterionPolarity {
  const { inclusion, exclusion } = splitSections(criteriaText);
  const quote = norm(sourceCriterion);
  if (!quote) return "unknown";
  const inInclusion = inclusion !== null && inclusion.includes(quote);
  const inExclusion = exclusion !== null && exclusion.includes(quote);
  if (inInclusion && !inExclusion) return "inclusion";
  if (inExclusion && !inInclusion) return "exclusion";
  return "unknown";
}

// Kept for test/back-compat callers: a simple section splitter view.
export function splitCriteriaSections(criteriaText: string): {
  inclusion: string;
  exclusion: string;
} {
  const s = splitSections(criteriaText);
  return { inclusion: s.inclusion ?? "", exclusion: s.exclusion ?? "" };
}

// ---------------------------------------------------------------------------
// (2) Negation guard — a question's text must not be negated relative to its rule.
// ---------------------------------------------------------------------------
// A yes/no rule-out question carries an implicit polarity. A negated phrasing flips the
// meaning so that answering "yes"/"no" means the OPPOSITE of what the fixed rule assumes.
// Because our question wording is server-authored from the registry we never emit a negation;
// this guard rejects one if it ever appears (defense in depth). NOTE: this guards the
// QUESTION TEXT, not the evidence — the evidence side is now guarded by the exact-line rule.
const NEGATION_RES: RegExp[] = [
  /\bdo\s+you\s+not\b/,
  /\bare\s+you\s+not\b/,
  /\bhave\s+you\s+not\b/,
  /\bnot\s+have\b/,
  /\bdon'?t\b/,
  /\bdoesn'?t\b/,
  /\baren'?t\b/,
  /\bhaven'?t\b/,
  /\bnever\b/,
  /\bno\s+history\s+of\b/,
  /\bwithout\b/,
  // Spanish negations (usted register questions).
  /\bno\s+tiene\b/,
  /\bno\s+está\b/,
  /\bnunca\b/,
  /\bsin\s+/,
];
/** True if the question text carries a meaning-flipping negation. */
export function hasNegation(questionText: string): boolean {
  const n = norm(questionText);
  return NEGATION_RES.some((re) => re.test(n));
}

// ---------------------------------------------------------------------------
// (3) Age SUBJECT parsing — identifies an age question by its wording.
// ---------------------------------------------------------------------------
const AGE_SUBJECT_RES: RegExp[] = [
  /\b(?:at\s+least|older\s+than|younger\s+than|over|under|aged)\s+(\d{1,3})\b/,
  /\b(\d{1,3})\s*(?:years?|yrs?)?\s*(?:of\s+age\s*)?(?:or|and)\s+(?:older|younger|above|below|more|less|over|under|up)\b/,
  /\b(\d{1,3})\s*(?:years?|yrs?)\s*(?:of\s+age)?\s*old\b/,
  // Spanish: "al menos 18 años", "18 años o menos", "18 años o más".
  /\bal\s+menos\s+(\d{1,3})\s*años\b/,
  /\b(\d{1,3})\s*años\s*(?:o|y)\s+(?:menos|más|mas|mayor|menor)\b/,
];
export interface AgeSubject {
  value: number;
  bound: "min" | "max";
}
/** Parse an age SUBJECT out of a question's text, or null if the question is not about age. */
export function parseAgeSubject(questionText: string): AgeSubject | null {
  const n = norm(questionText);
  let raw: string | undefined;
  for (const re of AGE_SUBJECT_RES) {
    const m = re.exec(n);
    if (m && m[1] !== undefined) {
      raw = m[1];
      break;
    }
  }
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const isUpper =
    /younger\s+than|\bunder\b|or\s+younger|and\s+younger|or\s+below|or\s+less|\bup\s+to\b|o\s+menos|o\s+menor/.test(
      n,
    );
  return { value, bound: isUpper ? "max" : "min" };
}

// ---------------------------------------------------------------------------
// (4) Condition SUBJECT matching — kept as a defense-in-depth cross-check.
// ---------------------------------------------------------------------------
interface ConditionClass {
  id: string;
  markers: RegExp[];
}
const DIABETES_T1: ConditionClass = {
  id: "diabetes_type_1",
  markers: [
    /type\s*1\s*diabetes/,
    /\bt1dm\b/,
    /type\s*i\s*diabetes/,
    /diabetes\s*(?:mellitus\s*)?tipo?\s*1/,
  ],
};
const DIABETES_T2: ConditionClass = {
  id: "diabetes_type_2",
  markers: [
    /type\s*2\s*diabetes/,
    /\bt2dm\b/,
    /type\s*ii\s*diabetes/,
    /diabetes\s*(?:mellitus\s*)?tipo?\s*2/,
  ],
};
const MUTUALLY_EXCLUSIVE_FAMILIES: ConditionClass[][] = [[DIABETES_T1, DIABETES_T2]];
function classMatches(cls: ConditionClass, text: string): boolean {
  return cls.markers.some((re) => re.test(text));
}
/**
 * Detect a condition-SUBJECT mismatch between the question text and the cited evidence.
 * Returns an error string, or null if no mismatch is detected.
 */
export function detectConditionMismatch(
  questionText: string,
  sourceCriterion: string,
): string | null {
  const q = norm(questionText);
  const ev = norm(sourceCriterion);
  for (const family of MUTUALLY_EXCLUSIVE_FAMILIES) {
    const qClasses = family.filter((c) => classMatches(c, q));
    const evClasses = family.filter((c) => classMatches(c, ev));
    if (qClasses.length === 0 || evClasses.length === 0) continue;
    const overlap = qClasses.some((qc) => evClasses.some((ec) => ec.id === qc.id));
    if (!overlap) {
      return `question subject (${qClasses.map((c) => c.id).join("/")}) does not match the cited evidence subject (${evClasses
        .map((c) => c.id)
        .join("/")}); the cited criterion is about a different condition`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// (5) Staff-only classes — kept so a question can never carry a staff-only subject/evidence.
// ---------------------------------------------------------------------------
interface StaffOnlyClass {
  id: string;
  markers: RegExp[];
}
const STAFF_ONLY_CLASSES: StaffOnlyClass[] = [
  {
    id: "care_management_enrollment",
    markers: [
      /complex\s*care\s*management/,
      /\bccm\b/,
      /care[-\s]*management\s*(program|enroll)/,
      /enrolled\s+in\s+.*care\s*management/,
    ],
  },
  { id: "deceased", markers: [/\bdeceased\b/, /\bis\s+dead\b/, /patients?\s+who\s+are\s+deceased/] },
  {
    id: "consent_ability",
    markers: [/able\s+to\s+(give|provide)\s+consent/, /ability\s+to\s+consent/, /capacity\s+to\s+consent/, /unable\s+to\s+consent/],
  },
  { id: "opted_out_research", markers: [/opted\s+out\s+of\s+research/, /declined\s+research/] },
  {
    id: "lab_cutoff_from_record",
    markers: [
      /(hba1c|a1c)\s*[≥>=<]/,
      /(hba1c|a1c)\s*(level|value)?\s*(of\s*)?[≥>=<]/,
      /(hba1c|a1c)\b[^.]*\b(≥|>=|≤|<=|greater than|less than|at least|at most|or higher|or more|or greater|or above|or lower|or less|or below)\b/,
      /(hba1c|a1c)\b[^.]*\b\d+(?:\.\d+)?\s*%?\s*(?:or\s+(?:higher|more|greater|above|lower|less|below))/,
      /\begfr\b\s*[≥>=<]/,
    ],
  },
  { id: "investigator_judgment", markers: [/investigator'?s?\s+(judgment|discretion|opinion)/, /per\s+investigator/, /clinician\s+judgment/] },
];
/** Return the staff-only class id a piece of text falls into, or null. */
export function staffOnlyClassOf(text: string): string | null {
  const n = norm(text);
  for (const cls of STAFF_ONLY_CLASSES) {
    if (cls.markers.some((re) => re.test(n))) return cls.id;
  }
  return null;
}
const EVIDENCE_STAFF_ONLY_IDS = new Set<string>([
  "care_management_enrollment",
  "deceased",
  "consent_ability",
  "opted_out_research",
  "investigator_judgment",
]);
/** Staff-only class of a cited EVIDENCE string, limited to inherently administrative ids. */
export function staffOnlyEvidenceClassOf(text: string): string | null {
  const n = norm(text);
  for (const cls of STAFF_ONLY_CLASSES) {
    if (EVIDENCE_STAFF_ONLY_IDS.has(cls.id) && cls.markers.some((re) => re.test(n))) {
      return cls.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// THE BACKSTOP: verify SERVER-CONSTRUCTED questions against the mapping + registry.
// ---------------------------------------------------------------------------
// Because questions are built server-side, this never runs against model creativity. It is a
// fail-closed assertion that the construction stayed faithful. If ANY question disagrees, we
// reject the whole model (safe error). Per question:
//  - the question id must be a known mapping id;
//  - FREE-TEXT: text must equal the mapping's own wording for this language; kind and
//    ruleOutIf must equal the mapping's fixed values; the study must be the pinned study and
//    its criteria hash must match; source_criterion must normalize to the mapping's exactLine
//    AND exactly one line in the declared section must equal it (matchExactLine); subject must
//    not mismatch; subject/evidence must not be staff-only; text must not be negated;
//  - AGE: kind "inclusion", ruleOutIf "no"; age-subject parses; structured-age citation whose
//    field matches the bound and value matches the study; text must not be negated.
export function checkQuestionSemantics(
  model: SimplifyModel,
  detail: TrialDetail,
  lang: Lang,
): string | null {
  const { minAgeYears, maxAgeYears, criteriaText } = detail.eligibility;
  if (!hasQuestionWording(lang)) {
    return `language "${lang}" has no supported question wording`;
  }
  const wordingLang: WordingLang = lang;
  const freeById = new Map(FREE_TEXT_MAPPINGS.map((m) => [m.id, m]));
  const ageById = new Map(AGE_MAPPINGS.map((m) => [m.id, m]));

  for (const q of model.questions) {
    const err = checkOneQuestion(q, {
      nctId: detail.nctId,
      criteriaText: criteriaText ?? "",
      minAgeYears,
      maxAgeYears,
      wordingLang,
      freeById,
      ageById,
    });
    if (err) return `question "${q.id}": ${err}`;
  }
  return null;
}

interface CheckCtx {
  nctId: string;
  criteriaText: string;
  minAgeYears: number | null;
  maxAgeYears: number | null;
  wordingLang: WordingLang;
  freeById: Map<string, (typeof FREE_TEXT_MAPPINGS)[number]>;
  ageById: Map<string, (typeof AGE_MAPPINGS)[number]>;
}

function checkOneQuestion(q: SimplifyQuestion, ctx: CheckCtx): string | null {
  // Negation guard applies to every question (server never emits one).
  if (hasNegation(q.text)) {
    return `question text is negated, which would flip its yes/no meaning relative to a fixed rule`;
  }
  // Staff-only subject/evidence can never be a question.
  const staffFromText = staffOnlyClassOf(q.text);
  const staffFromEvidence = staffOnlyEvidenceClassOf(q.source_criterion);
  if (staffFromText || staffFromEvidence) {
    return `is a staff-only/administrative criterion (${staffFromText ?? staffFromEvidence}) and must be in staff_checks, not asked as a question`;
  }

  const ageMapping = ctx.ageById.get(q.id);
  if (ageMapping) return checkAgeQuestion(q, ageMapping, ctx);

  const freeMapping = ctx.freeById.get(q.id);
  if (freeMapping) return checkFreeTextQuestion(q, freeMapping, ctx);

  // Unknown id -> not produced by any supported mapping -> reject (fail closed).
  return `id is not a supported mapping id (unknown/unsupported question)`;
}

function checkAgeQuestion(
  q: SimplifyQuestion,
  mapping: (typeof AGE_MAPPINGS)[number],
  ctx: CheckCtx,
): string | null {
  // AGE POLARITY is FIXED: inclusion / ruleOutIf "no".
  if (q.kind !== "inclusion") return `age question must have kind "inclusion" (got "${q.kind}")`;
  if (q.ruleOutIf !== "no") return `age question must have ruleOutIf "no" (got "${q.ruleOutIf}")`;
  const subject = parseAgeSubject(q.text);
  if (!subject) return `age question text has no parseable age subject`;
  if (subject.bound !== mapping.bound) {
    return `age question text expresses a ${subject.bound} bound but the mapping is for the ${mapping.bound} bound`;
  }
  if (!isStructuredAgeCriterion(q.source_criterion)) {
    return `age question source_criterion must cite the structured age bounds`;
  }
  const parsed = parseStructuredAgeCitation(q.source_criterion);
  if (!parsed) return `age question structured-age citation could not be parsed`;
  if (parsed.field !== mapping.bound) {
    return `age question cites the ${parsed.field} bound but the mapping is for the ${mapping.bound} bound`;
  }
  const actual = mapping.bound === "min" ? ctx.minAgeYears : ctx.maxAgeYears;
  if (actual === null) return `age question cites a ${mapping.bound} bound the study does not have`;
  if (subject.value !== actual || parsed.value !== actual) {
    return `age question value (${subject.value}) / citation (${parsed.value}) does not match the study's ${mapping.bound} bound (${actual})`;
  }
  return null;
}

function checkFreeTextQuestion(
  q: SimplifyQuestion,
  mapping: (typeof FREE_TEXT_MAPPINGS)[number],
  ctx: CheckCtx,
): string | null {
  // TEXT must be the mapping's own deterministic wording for this language.
  const expectedText = mapping.wording[ctx.wordingLang];
  if (q.text !== expectedText) {
    return `text does not match the server mapping wording for this language`;
  }
  // KIND + RULEOUTIF are FIXED by the mapping.
  if (q.kind !== mapping.section) {
    return `kind "${q.kind}" does not match the mapping section "${mapping.section}"`;
  }
  if (q.ruleOutIf !== mapping.ruleOutIf) {
    return `ruleOutIf "${q.ruleOutIf}" does not match the mapping's fixed value "${mapping.ruleOutIf}"`;
  }
  // SUBJECT cross-check (diabetes family) — must not be a mismatch.
  const mismatch = detectConditionMismatch(q.text, q.source_criterion);
  if (mismatch) return mismatch;

  // STUDY PIN: the study must be the one this mapping is pinned to.
  if (normNctId(ctx.nctId) !== mapping.nctId) {
    return `study ${normNctId(ctx.nctId)} is not the pinned study ${mapping.nctId} for this mapping`;
  }
  // CRITERIA-REVISION HASH: the study's criteria must be the reviewed revision.
  const expectedHash = REVIEWED_CRITERIA_HASH[mapping.nctId];
  if (!expectedHash) {
    return `no reviewed criteria hash is stored for ${mapping.nctId}`;
  }
  const actualHash = criteriaRevisionHash(ctx.criteriaText);
  if (actualHash !== expectedHash) {
    return `criteria-revision hash mismatch for ${mapping.nctId} (registry revised); no free-text question is valid`;
  }
  // EXACT-LINE: source_criterion must normalize to the mapping's exactLine AND exactly one
  // line in the declared section must equal it. No substring matching.
  if (normalizeLine(q.source_criterion) !== normalizeLine(mapping.exactLine)) {
    return `source_criterion does not normalize to the mapping's reviewed exact line`;
  }
  const { inclusionRaw, exclusionRaw } = splitSections(ctx.criteriaText);
  const sectionRaw = mapping.section === "inclusion" ? inclusionRaw : exclusionRaw;
  if (sectionRaw === null) {
    return `the ${mapping.section} section is missing or ambiguous, so the exact line cannot be confirmed`;
  }
  const matched = matchExactLine(sectionRaw, mapping.exactLine);
  if (matched === null) {
    return `the reviewed exact line does not uniquely appear in the ${mapping.section} section`;
  }
  if (normalizeLine(matched) !== normalizeLine(q.source_criterion)) {
    return `the section's matched line does not equal the question's source_criterion`;
  }
  return null;
}
