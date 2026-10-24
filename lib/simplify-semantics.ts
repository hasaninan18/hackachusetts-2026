// Semantic safety validation for the simplify pipeline (spec: simplify).
//
// WHY THIS MODULE EXISTS (production semantic-safety fix):
// HTTP 200, green shape/safety validators, preserved protected values, and a
// source_criterion substring that EXISTS in the criteria text are all NECESSARY but NOT
// SUFFICIENT for a question to be correct. The live defect that motivated this module:
//
//   question text:     "Do you have type 2 diabetes?"
//   ruleOutIf:         "yes"
//   kind:              "exclusion"
//   source_criterion:  "Patients with Type 1 Diabetes Mellitus (T1DM)."  <- EXISTS in criteria
//
// The quote is a real substring of the criteria, so substring matching PASSED — but the
// question asks about TYPE 2 while the cited evidence is about TYPE 1, and the declared
// rule-out ("answer yes -> ruled out") would wrongly exclude a patient who HAS type 2
// diabetes (which is the study's INCLUSION condition). This is a dangerous meaning
// mismatch that no shape/substring check catches.
//
// This module is the SEMANTIC AUTHORITY. It is SDK-FREE (pure functions, no I/O) so it
// can be unit-tested without Bedrock and never drags the AWS SDK into any bundle. The
// orchestrator in lib/bedrock.ts runs these checks as an `extraValidate` step; a failure
// triggers the existing bounded retry/fallback and, if no attempt produces a semantically
// valid output, the pipeline returns a safe error (the route turns that into a 503). We
// FAIL CLOSED: a question we cannot positively confirm as supported is REJECTED.
//
// DESIGN PRINCIPLE (per the fix brief): prefer DETERMINISTIC supported mappings derived
// from the registry criteria over trusting arbitrary model-asserted rule-out logic.
// Prompt text and substring matching alone are explicitly insufficient.
import type { SimplifyModel, SimplifyQuestion } from "./bedrock-types";
import type { TrialDetail } from "./types";

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------
/** Collapse whitespace, lower-case, trim — for robust substring/keyword comparison. */
export function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// (1) Inclusion vs Exclusion polarity of the CITED EVIDENCE
// ---------------------------------------------------------------------------
// The registry criteria text is sectioned into "Inclusion Criteria:" and
// "Exclusion Criteria:". We determine, for a given quoted source_criterion, which SECTION
// it lives in. That is the authoritative inclusion/exclusion polarity of the evidence —
// NOT the model's self-declared `kind`. If the model's `kind` disagrees with the section
// the quote actually came from, that is a mismatch and we reject.

export type CriterionPolarity = "inclusion" | "exclusion" | "unknown";

const INCLUSION_HEADER_RE = /\binclusion\b(?:\s*criteria)?\s*:?/i;
const EXCLUSION_HEADER_RE = /\bexclusion\b(?:\s*criteria)?\s*:?/i;

/**
 * Split the criteria text into the inclusion block and the exclusion block (normalized).
 * If no headers are present, everything is treated as the inclusion block (registries
 * commonly list only inclusion criteria), and the exclusion block is empty.
 */
export function splitCriteriaSections(criteriaText: string): {
  inclusion: string;
  exclusion: string;
} {
  const text = criteriaText ?? "";
  const incMatch = INCLUSION_HEADER_RE.exec(text);
  const excMatch = EXCLUSION_HEADER_RE.exec(text);
  // No exclusion header: all of it is inclusion-ish.
  if (!excMatch) {
    return { inclusion: norm(text), exclusion: "" };
  }
  const excStart = excMatch.index;
  // Inclusion runs from the inclusion header (or start) up to the exclusion header.
  const incStart = incMatch ? incMatch.index : 0;
  const inclusion = text.slice(incStart, excStart);
  const exclusion = text.slice(excStart);
  return { inclusion: norm(inclusion), exclusion: norm(exclusion) };
}

/**
 * Determine the authoritative polarity of a quoted source_criterion by locating it in the
 * inclusion vs exclusion section of the criteria text. Returns "unknown" when the quote is
 * not substantively present in either section (callers treat unknown as a failure to
 * ground, i.e. reject — fail closed).
 */
export function evidencePolarity(
  sourceCriterion: string,
  criteriaText: string,
): CriterionPolarity {
  const { inclusion, exclusion } = splitCriteriaSections(criteriaText);
  const quote = norm(sourceCriterion);
  if (!quote) return "unknown";
  const inInclusion = inclusion.includes(quote);
  const inExclusion = exclusion.includes(quote);
  if (inInclusion && !inExclusion) return "inclusion";
  if (inExclusion && !inInclusion) return "exclusion";
  // Present in neither, or ambiguously in both -> we cannot attribute a polarity.
  return "unknown";
}

// ---------------------------------------------------------------------------
// (2) Condition SUBJECT matching (question subject vs evidence subject)
// ---------------------------------------------------------------------------
// The condition a question ASKS ABOUT must be the condition the cited evidence DESCRIBES.
// The motivating bug is diabetes type: a "type 2 diabetes" question must not be grounded in
// a "Type 1 Diabetes" criterion. We detect a small set of mutually-exclusive condition
// CLASSES where confusing one for another is clinically dangerous, and additionally apply a
// GENERAL principle: salient condition nouns named in the question must appear in the quote.

/** A named condition class with the markers that identify it in free text. */
interface ConditionClass {
  id: string;
  /** Regexes that indicate this specific class is present. */
  markers: RegExp[];
}

// Mutually-exclusive classes: if the question is about one and the evidence is about a
// DIFFERENT one in the same family, that is a subject mismatch.
const DIABETES_T1: ConditionClass = {
  id: "diabetes_type_1",
  // English + the supported languages' phrasings (es/pt "tipo 1", ht "tip 1",
  // vi "loai 1/type 1", zh "1 xing/1 xing tang niao bing"). source_criterion stays English
  // but a TRANSLATED question text must still be classifiable so the subject check holds.
  markers: [
    /type\s*1\s*diabetes/,
    /\bt1dm\b/,
    /type\s*i\s*diabetes/,
    /diabetes\s*(?:mellitus\s*)?tipo?\s*1/, // es/pt: "diabetes tipo 1"
    /diabetes\s*tip\s*1/, // ht
    /(?:tieu\s*duong|dai\s*thao\s*duong|đái\s*tháo\s*đường|tiểu\s*đường)\s*(?:loại|loai|type|týp|typ)\s*1/, // vi
    /1\s*型\s*糖尿病/, // zh "1型糖尿病"
  ],
};
const DIABETES_T2: ConditionClass = {
  id: "diabetes_type_2",
  markers: [
    /type\s*2\s*diabetes/,
    /\bt2dm\b/,
    /type\s*ii\s*diabetes/,
    /diabetes\s*(?:mellitus\s*)?tipo?\s*2/, // es/pt: "diabetes tipo 2"
    /diabetes\s*tip\s*2/, // ht
    /(?:tieu\s*duong|dai\s*thao\s*duong|đái\s*tháo\s*đường|tiểu\s*đường)\s*(?:loại|loai|type|týp|typ)\s*2/, // vi
    /2\s*型\s*糖尿病/, // zh "2型糖尿病"
  ],
};

/** Families whose members are mutually exclusive subjects. */
const MUTUALLY_EXCLUSIVE_FAMILIES: ConditionClass[][] = [[DIABETES_T1, DIABETES_T2]];

function classMatches(cls: ConditionClass, text: string): boolean {
  return cls.markers.some((re) => re.test(text));
}

/**
 * Detect a condition-SUBJECT mismatch between the question text and the cited evidence.
 * For each mutually-exclusive family, if the QUESTION names one member and the EVIDENCE
 * names a DIFFERENT member (and not the one the question names), that is a hard mismatch.
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
    // The question is about some member(s); the evidence is about some member(s).
    // If the evidence does NOT include any class the question is about, it is the WRONG
    // member of the family -> dangerous subject mismatch.
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
// (3) Staff-only / administrative / not-self-knowable criterion classes (DEMO_DATA rule 7)
// ---------------------------------------------------------------------------
// These must never be asked as a yes/no question — they belong in staff_checks. A question
// whose SUBJECT or whose cited EVIDENCE falls into one of these classes is rejected.
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
    // Lab thresholds pulled from the medical record (not self-knowable precise values):
    // HbA1c/A1c with a numeric comparator, eGFR, etc. These go to staff_checks per rule 7.
    markers: [
      /(hba1c|a1c)\s*[≥>=<]/,
      /(hba1c|a1c)\s*(level|value)?\s*(of\s*)?[≥>=<]/,
      // Word-form thresholds tied to the lab name: "A1c ... 9% or higher", "at least 9%",
      // "9 percent or more", "below 7", etc. A precise lab threshold from the record is not
      // self-knowable, so a QUESTION asking it must go to staff_checks (DEMO_DATA rule 7).
      /(hba1c|a1c)\b[^.]*\b(≥|>=|≤|<=|greater than|less than|at least|at most|or higher|or more|or greater|or above|or lower|or less|or below)\b/,
      /(hba1c|a1c)\b[^.]*\b\d+(?:\.\d+)?\s*%?\s*(?:or\s+(?:higher|more|greater|above|lower|less|below))/,
      /\begfr\b\s*[≥>=<]/,
    ],
  },
  { id: "investigator_judgment", markers: [/investigator'?s?\s+(judgment|discretion|opinion)/, /per\s+investigator/, /clinician\s+judgment/] },
];

/**
 * Return the staff-only class id a piece of text falls into, or null. Used to reject a
 * QUESTION whose subject or cited evidence is staff-only, and (positively) to confirm such
 * an item was routed to staff_checks.
 */
export function staffOnlyClassOf(text: string): string | null {
  const n = norm(text);
  for (const cls of STAFF_ONLY_CLASSES) {
    if (cls.markers.some((re) => re.test(n))) return cls.id;
  }
  return null;
}
// Classes that make a QUESTION staff-only purely because of its cited EVIDENCE, regardless
// of how the question is phrased. These are inherently administrative/not-self-knowable at
// the criterion level. `lab_cutoff_from_record` is DELIBERATELY excluded here: a lab value
// (e.g. "...or an HbA1c level >=6.5%") can appear inside a broader, self-knowable diagnosis
// criterion, so a lab mention in the EVIDENCE must not by itself condemn an otherwise valid
// question (e.g. "Do you have type 2 diabetes?"). A question that ASKS the patient to
// self-report a precise lab value is still caught via its TEXT.
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
// (4) Age-subject questions must be grounded in STRUCTURED bounds
// ---------------------------------------------------------------------------
// An age question is identified by its SUBJECT ("at least N years", "N years or older",
// "N years of age or older", "younger than N"), NOT by whether its citation mentions "age".
// Such a question MUST cite the structured minimumAge/maximumAge (so the structured-age
// validator in lib/bedrock.ts runs) and its numeric subject must match the structured
// value. A question that asks an age but cites unrelated free text (the observed bug, where
// the age question cited the T2DM diagnosis paragraph) is REJECTED.

// A question is an AGE question if its text expresses a numeric age threshold. We match a
// numeric bound in any of these shapes (the number is captured):
//   "at least N", "older than N", "younger than N", "over N", "under N", "aged N"
//   "N or older", "N or younger", "N years or older", "N years of age or older"
//   "N years old" (lower-bound phrasing)
// The word "years" is OPTIONAL so "18 or older" is recognized.
const AGE_SUBJECT_RES: RegExp[] = [
  /\b(?:at\s+least|older\s+than|younger\s+than|over|under|aged)\s+(\d{1,3})\b/,
  /\b(\d{1,3})\s*(?:years?|yrs?)?\s*(?:of\s+age\s*)?(?:or|and)\s+(?:older|younger|above|below|more|less|over|under|up)\b/,
  /\b(\d{1,3})\s*(?:years?|yrs?)\s*(?:of\s+age)?\s*old\b/,
];

export interface AgeSubject {
  /** The numeric age the question asks about. */
  value: number;
  /** Whether the phrasing is a lower bound ("at least N", "N or older") or an upper bound. */
  bound: "min" | "max";
}

/**
 * Parse an age SUBJECT out of a question's text, or null if the question is not about age.
 * "at least 18", "18 years or older" -> {value:18, bound:"min"}; "younger than 65",
 * "65 years or younger" -> {value:65, bound:"max"}.
 */
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
  // Decide bound direction from the wording. Upper-bound phrasings cap age from above.
  const isUpper =
    /younger\s+than|\bunder\b|or\s+younger|and\s+younger|or\s+below|or\s+less|\bup\s+to\b/.test(
      n,
    );
  return { value, bound: isUpper ? "max" : "min" };
}

// ---------------------------------------------------------------------------
// The public semantic validator
// ---------------------------------------------------------------------------
import { isStructuredAgeCriterion, parseStructuredAgeCitation } from "./bedrock-age";

/**
 * Validate a model's semantics against the study's REAL criteria. Returns an error string
 * (fail closed) on the first violation, or null if every question is positively supported.
 *
 * Per-question checks:
 *  A. STAFF-ONLY: if the question's subject or its cited evidence is a staff-only class
 *     (CCM/care-management, deceased, consent, opted-out, lab cutoff from record,
 *     investigator judgment), REJECT — it must be a staff_check, not a question (rule 7).
 *  B. AGE GROUNDING: if the question's SUBJECT is an age ("at least N years" etc.), it MUST
 *     cite the structured age bounds and the structured field must exist with a value that
 *     matches the question's numeric subject. An age question citing unrelated free text is
 *     REJECTED (the observed bug).
 *  C. SUBJECT MATCH: the condition named in the question must be the condition named in the
 *     cited evidence (e.g. a type-2-diabetes question may not cite a type-1-diabetes
 *     criterion). REJECT a mismatch.
 *  D. POLARITY/KIND CONSISTENCY: for a NON-age, free-text-grounded question, the evidence's
 *     authoritative polarity (which section of the criteria it lives in) must match the
 *     declared `kind`, and `ruleOutIf` must be consistent with that polarity:
 *       - inclusion criterion ("must have X")  -> kind=inclusion, ruleOutIf="no"
 *         (you are ruled out by failing an inclusion, i.e. answering "no" to "do you have X")
 *       - exclusion criterion ("patients with Y") -> kind=exclusion, ruleOutIf="yes"
 *         (you are ruled out by meeting an exclusion, i.e. answering "yes" to "do you have Y")
 *     If evidence polarity is unknown (quote not cleanly in one section), REJECT.
 */
export function checkQuestionSemantics(
  model: SimplifyModel,
  detail: TrialDetail,
): string | null {
  const { minAgeYears, maxAgeYears, criteriaText } = detail.eligibility;
  for (const q of model.questions) {
    const err = checkOneQuestion(q, criteriaText, minAgeYears, maxAgeYears);
    if (err) return `question "${q.id}": ${err}`;
  }
  return null;
}

function checkOneQuestion(
  q: SimplifyQuestion,
  criteriaText: string,
  minAgeYears: number | null,
  maxAgeYears: number | null,
): string | null {
  // A. STAFF-ONLY — a question derived from a staff-only criterion must not be asked.
  const staffFromText = staffOnlyClassOf(q.text);
  const staffFromEvidence = staffOnlyEvidenceClassOf(q.source_criterion);
  if (staffFromText || staffFromEvidence) {
    return `is a staff-only/administrative criterion (${staffFromText ?? staffFromEvidence}) and must be in staff_checks, not asked as a question`;
  }

  // B. AGE GROUNDING — an age-subject question must be grounded in structured bounds.
  const ageSubject = parseAgeSubject(q.text);
  if (ageSubject) {
    if (!isStructuredAgeCriterion(q.source_criterion)) {
      return `is an age question (asks about ${ageSubject.value} years) but its source_criterion does not cite the structured age bounds; it must be grounded in minimumAge/maximumAge`;
    }
    const parsed = parseStructuredAgeCitation(q.source_criterion);
    if (!parsed) {
      return `is an age question but its structured-age citation could not be parsed into a field/value`;
    }
    // The cited structured field must match the direction the question asks about.
    if (parsed.field !== ageSubject.bound) {
      return `asks a ${ageSubject.bound === "min" ? "minimum" : "maximum"}-age question but cites the ${parsed.field === "min" ? "minimumAge" : "maximumAge"} field`;
    }
    const actual = ageSubject.bound === "min" ? minAgeYears : maxAgeYears;
    if (actual === null) {
      return `asks a ${ageSubject.bound === "min" ? "minimum" : "maximum"}-age question but the study has no such structured bound`;
    }
    if (ageSubject.value !== actual) {
      return `asks about ${ageSubject.value} years but the study's structured ${ageSubject.bound === "min" ? "minimumAge" : "maximumAge"} is ${actual}`;
    }
    // Age question is well-grounded; checkSourceCriteria validates the citation value too.
    return null;
  }

  // C. SUBJECT MATCH — the condition in the question must be the condition in the evidence.
  const mismatch = detectConditionMismatch(q.text, q.source_criterion);
  if (mismatch) return mismatch;

  // D. POLARITY / KIND CONSISTENCY against the evidence's actual section.
  const polarity = evidencePolarity(q.source_criterion, criteriaText);
  if (polarity === "unknown") {
    return `cited source_criterion could not be located in either the inclusion or exclusion section, so its polarity cannot be confirmed`;
  }
  if (polarity !== q.kind) {
    return `is declared kind="${q.kind}" but its cited evidence is in the ${polarity} section`;
  }
  // ruleOutIf must follow from the polarity:
  //   inclusion -> ruleOutIf "no"  (failing an inclusion rules you out)
  //   exclusion -> ruleOutIf "yes" (meeting an exclusion rules you out)
  const expectedRuleOut = polarity === "inclusion" ? "no" : "yes";
  if (q.ruleOutIf !== expectedRuleOut) {
    return `cites an ${polarity} criterion so ruleOutIf should be "${expectedRuleOut}", but it is "${q.ruleOutIf}"`;
  }
  return null;
}
