// DEFAULT-DENY mapping registry for the simplify checklist (spec: simplify) — SDK-FREE.
//
// WHY THIS MODULE EXISTS (the production semantic-safety redesign):
// The previous validator was DEFAULT-ALLOW: it accepted any model-authored question and
// only rejected the specific mismatches it had been taught (the T1/T2 diabetes family,
// section polarity, a handful of staff-only keywords). Anything outside those taught
// patterns passed, including:
//   - "Do you have asthma?" cited to "Must have type 2 diabetes." (subject never required
//     to equal the evidence subject unless it was a known family);
//   - "Do you NOT have type 2 diabetes?" with kind=inclusion/ruleOutIf=no (negation flips
//     the meaning but nothing flipped or checked the rule);
//   - "Are you at least 18 years old?" cited to minimumAge with kind=exclusion/ruleOutIf=yes
//     (the age path checked field+value but never age polarity).
//
// The fix is a DESIGN change, not more keyword checks: the SERVER now BUILDS the checklist
// from a finite set of supported, deterministic criterion->question mappings. The model no
// longer authors question wording or rule-out logic at all (design choice (a)). Each mapping
// fixes, server-side and immutably:
//   - which registry fact it REQUIRES (a matcher over the study's verified criteria text in
//     an UNAMBIGUOUS section, or a structured field);
//   - the SECTION it must live in (inclusion/exclusion), from explicit headings;
//   - kind and ruleOutIf (never taken from the model);
//   - deterministic, handwritten patient-facing wording per supported language;
//   - the source evidence, which the SERVER extracts VERBATIM from the registry text (never
//     the model's copy).
// Anything not covered by a mapping is REJECTED (fail closed): unknown subjects, unsupported
// wording, ambiguous evidence, compound/negated criteria without explicit support, quotes
// outside a clear section, or missing/ambiguous headings. Missing or ambiguous headings must
// NOT silently default to inclusion.
//
// This module is PURE and SDK-FREE so it unit-tests without Bedrock and never drags the AWS
// SDK into any bundle. lib/bedrock.ts calls buildChecklist() during orchestration;
// lib/simplify-semantics.ts re-uses the section splitter as the single authority on headings.
import type { Lang } from "./types";
import type { TrialDetail } from "./types";
import type { SimplifyQuestion } from "./bedrock-types";

// ---------------------------------------------------------------------------
// Supported languages for DETERMINISTIC question wording.
// ---------------------------------------------------------------------------
// Question MEANING and rule-out logic are fixed server-side; only the surface wording is
// localized, and ONLY from handwritten strings here. We ship deterministic wording for en
// and es (the hero languages). For pt/ht/zh/vi we FAIL CLOSED: we do not have reviewed,
// faithful question wording in those languages, and machine translation of a yes/no
// rule-out question can silently flip disease type, negation, numbers, or age direction —
// exactly the class of defect this redesign exists to prevent. The summary/whatYouDo/etc.
// PROSE may still be model-translated (it carries no rule-out logic and keeps passing the
// existing safety + identifier checks), but the CHECKLIST itself is en/es only.
export type WordingLang = "en" | "es";
export const QUESTION_WORDING_LANGS = ["en", "es"] as const satisfies readonly WordingLang[];

/** True when we have deterministic, reviewed question wording for a language. */
export function hasQuestionWording(lang: Lang): lang is WordingLang {
  return (QUESTION_WORDING_LANGS as readonly string[]).includes(lang);
}

// ---------------------------------------------------------------------------
// Section splitting — the SINGLE authority on inclusion/exclusion headings.
// ---------------------------------------------------------------------------
// A mapping may only match a fact inside the section it declares, and only when that section
// is UNAMBIGUOUSLY delimited by an explicit heading. We deliberately do NOT fall back to
// "treat everything as inclusion" the way the old splitter did: a criteria block with no
// usable headings yields NO usable sections, so free-text mappings cannot match and the
// study fails closed. (Structured-age questions do not depend on sections.)
const INCLUSION_HEADER_RE = /\binclusion\s+criteria\b\s*:?/i;
const EXCLUSION_HEADER_RE = /\bexclusion\s+criteria\b\s*:?/i;

/** Collapse whitespace, lower-case, trim — robust substring matching. */
export function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export interface CriteriaSections {
  /** Normalized inclusion-section text, or null when it cannot be unambiguously located. */
  inclusion: string | null;
  /** Normalized exclusion-section text, or null when it cannot be unambiguously located. */
  exclusion: string | null;
  /** The raw (un-normalized) inclusion slice, for verbatim evidence extraction. */
  inclusionRaw: string | null;
  /** The raw (un-normalized) exclusion slice, for verbatim evidence extraction. */
  exclusionRaw: string | null;
}

/**
 * Split criteria text into inclusion/exclusion slices using EXPLICIT headings only. A
 * section is returned only when exactly one heading of its type is present and the slice is
 * unambiguous; otherwise that section is null (fail closed — callers reject). Duplicate
 * headings of the same type, or an exclusion heading appearing before an inclusion heading,
 * make the layout ambiguous and yield null sections.
 */
export function splitSections(criteriaText: string): CriteriaSections {
  const text = criteriaText ?? "";
  const incMatches = [...text.matchAll(new RegExp(INCLUSION_HEADER_RE, "gi"))];
  const excMatches = [...text.matchAll(new RegExp(EXCLUSION_HEADER_RE, "gi"))];
  const NONE: CriteriaSections = {
    inclusion: null,
    exclusion: null,
    inclusionRaw: null,
    exclusionRaw: null,
  };
  // Ambiguous: more than one heading of a kind. We cannot know which slice is authoritative.
  if (incMatches.length > 1 || excMatches.length > 1) return NONE;
  const incAt = incMatches.length === 1 ? incMatches[0].index ?? -1 : -1;
  const excAt = excMatches.length === 1 ? excMatches[0].index ?? -1 : -1;
  // No usable heading at all -> no sections (do NOT default to inclusion).
  if (incAt < 0 && excAt < 0) return NONE;
  // Both present: inclusion must come before exclusion, else ambiguous ordering.
  if (incAt >= 0 && excAt >= 0) {
    if (incAt >= excAt) return NONE;
    const inclusionRaw = text.slice(incAt, excAt);
    const exclusionRaw = text.slice(excAt);
    return {
      inclusion: norm(inclusionRaw),
      exclusion: norm(exclusionRaw),
      inclusionRaw,
      exclusionRaw,
    };
  }
  // Only inclusion heading present.
  if (incAt >= 0) {
    const inclusionRaw = text.slice(incAt);
    return { inclusion: norm(inclusionRaw), exclusion: null, inclusionRaw, exclusionRaw: null };
  }
  // Only exclusion heading present.
  const exclusionRaw = text.slice(excAt);
  return { inclusion: null, exclusion: norm(exclusionRaw), exclusionRaw, inclusionRaw: null };
}

// ---------------------------------------------------------------------------
// Verbatim evidence extraction — the server quotes the registry, never the model.
// ---------------------------------------------------------------------------
/** Normalized-substring test against a (possibly null) section. */
function sectionIncludes(section: string | null, evidenceMatch: string): boolean {
  if (section === null) return false;
  return section.includes(norm(evidenceMatch));
}

/**
 * Extract the verbatim registry line (bullet/sentence) that contains `evidenceMatch` from
 * the raw section slice. Returns null when it cannot be found unambiguously. We split the
 * raw slice into lines and return the single trimmed line whose normalized form contains the
 * match — the registry formats each criterion as its own bullet line.
 */
function extractVerbatim(sectionRaw: string | null, evidenceMatch: string): string | null {
  if (sectionRaw === null) return null;
  const needle = norm(evidenceMatch);
  const lines = sectionRaw.split(/\r?\n/);
  const hits = lines
    .map((l) => l.replace(/^\s*[*\-•]\s*/, "").trim()) // strip bullet markers
    .filter((l) => l.length > 0 && norm(l).includes(needle));
  if (hits.length !== 1) return null; // ambiguous or absent -> fail closed
  return hits[0];
}

// ---------------------------------------------------------------------------
// Negated-evidence guard — a mapping must NOT fire on a negated criterion line.
// ---------------------------------------------------------------------------
// A mapping encodes the PRESENCE of a fact ("Do you have type 2 diabetes?"). If the matched
// registry line negates that fact ("No history of type 2 diabetes mellitus (T2DM)", "without
// type 1 diabetes", "sin diabetes"), the line means the OPPOSITE and the mapping's fixed
// wording/polarity would be wrong. We fail closed on any negated evidence line so a negated
// criterion can never be rendered as a positive yes/no question. (The question wording itself
// is server-authored and never negated; this guards the EVIDENCE side.)
const EVIDENCE_NEGATION_RES: RegExp[] = [
  /\bno\s+history\s+of\b/,
  /\bno\s+known\b/,
  /\bno\s+prior\b/,
  /\bwithout\b/,
  /\bnot\s+have\b/,
  /\bdoes\s+not\b/,
  /\bdo\s+not\b/,
  /\bnever\b/,
  /\babsence\s+of\b/,
  /\bfree\s+of\b/,
  /\bexcept\b/,
  // Spanish negations.
  /\bsin\s+/,
  /\bno\s+tiene\b/,
  /\bausencia\s+de\b/,
];
/** True if a verbatim evidence line carries a meaning-flipping negation. */
export function evidenceIsNegated(line: string): boolean {
  const n = norm(line);
  return EVIDENCE_NEGATION_RES.some((re) => re.test(n));
}

// ---------------------------------------------------------------------------
// The mapping registry.
// ---------------------------------------------------------------------------
export type Section = "inclusion" | "exclusion";

/** Localized question wording for the supported languages. */
export type Wording = Record<WordingLang, string>;

export interface FreeTextMapping {
  kind: "free_text";
  /** Stable id used as the question id in the response. */
  id: string;
  /** The section this fact MUST live in, from explicit headings. */
  section: Section;
  /**
   * Normalized substring that must occur in `section`. This is the REQUIRED registry fact.
   * It is intentionally specific (names the exact condition) so a near-miss does not match.
   */
  evidenceMatch: string;
  /**
   * Normalized substrings that, if they appear ON THE SAME matched line, make the fact
   * ambiguous for THIS mapping and cause it to be skipped (fail closed). Used to keep type-1
   * and type-2 diabetes strictly distinct: the T2 mapping must not fire on a line that is
   * actually about T1, and vice versa.
   */
  disqualifyIfAlsoMatches?: string[];
  /** FIXED rule-out polarity — never taken from the model. */
  ruleOutIf: "yes" | "no";
  /** Deterministic, handwritten patient-facing wording per supported language. */
  wording: Wording;
}

export interface AgeMapping {
  kind: "age";
  id: string;
  /** Which structured bound this maps. */
  bound: "min" | "max";
}

export type Mapping = FreeTextMapping | AgeMapping;

/**
 * THE SUPPORTED FREE-TEXT MAPPINGS. Deliberately small and hero-trial focused. Each entry is
 * a deterministic, reviewed criterion->question mapping. Adding a study or a criterion means
 * adding an entry here, not trusting the model.
 *
 * For NCT07043426 (THRIVE-DM, BMC) the registry criteria are:
 *   Inclusion:
 *     * Diagnosis: Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM) ...   -> SUPPORTED
 *     * Uncontrolled T2DM: Must have an HbA1c >=9% at the time of screening.      -> NOT supported
 *         (a precise lab value from the record is not self-knowable -> staff_checks, rule 7/10)
 *     * Health-Related Social Needs: Must have been screened ... GIM visit ...    -> NOT supported
 *         (compound: screened AND screened-positive, during a specific visit type; cannot be
 *          phrased as one faithful self-knowable yes/no without adding meaning -> rejected)
 *   Exclusion:
 *     * Patients enrolled in Complex Care Management (CCM).                         -> staff-only
 *     * Patients receiving hospice care.                                            -> SUPPORTED
 *     * Patients who are deceased                                                   -> staff-only
 *     * Patients with Type 1 Diabetes Mellitus (T1DM).                              -> SUPPORTED
 */
export const FREE_TEXT_MAPPINGS: FreeTextMapping[] = [
  {
    kind: "free_text",
    id: "t2dm_diagnosis",
    section: "inclusion",
    evidenceMatch: "type 2 diabetes mellitus (t2dm)",
    disqualifyIfAlsoMatches: ["type 1 diabetes", "t1dm"],
    ruleOutIf: "no", // inclusion: failing it (answering "no") rules you out
    wording: {
      en: "Do you have type 2 diabetes?",
      es: "¿Tiene diabetes tipo 2?",
    },
  },
  {
    kind: "free_text",
    id: "t1dm_exclusion",
    section: "exclusion",
    evidenceMatch: "type 1 diabetes mellitus (t1dm)",
    disqualifyIfAlsoMatches: ["type 2 diabetes", "t2dm"],
    ruleOutIf: "yes", // exclusion: meeting it (answering "yes") rules you out
    wording: {
      en: "Do you have type 1 diabetes?",
      es: "¿Tiene diabetes tipo 1?",
    },
  },
  {
    kind: "free_text",
    id: "hospice",
    section: "exclusion",
    evidenceMatch: "hospice care",
    ruleOutIf: "yes",
    wording: {
      en: "Are you currently receiving hospice care?",
      es: "¿Está recibiendo cuidados de hospicio (hospice) actualmente?",
    },
  },
];

/** The age mappings (built from structured bounds only). */
export const AGE_MAPPINGS: AgeMapping[] = [
  { kind: "age", id: "age_min", bound: "min" },
  { kind: "age", id: "age_max", bound: "max" },
];

// ---------------------------------------------------------------------------
// Deterministic age wording.
// ---------------------------------------------------------------------------
function ageWording(bound: "min" | "max", value: number, lang: WordingLang): string | null {
  if (bound === "min") {
    if (lang === "en") return `Are you at least ${value} years old?`;
    if (lang === "es") return `¿Tiene al menos ${value} años?`;
  } else {
    if (lang === "en") return `Are you ${value} years old or younger?`;
    if (lang === "es") return `¿Tiene ${value} años o menos?`;
  }
  return null;
}

/** Deterministic structured-age source evidence, formatted server-side. */
function ageEvidence(bound: "min" | "max", value: number): string {
  return `${bound === "min" ? "minimumAge" : "maximumAge"} = ${value} years`;
}

// ---------------------------------------------------------------------------
// Selection + construction.
// ---------------------------------------------------------------------------
export interface BuiltQuestion extends SimplifyQuestion {
  /** The mapping id that produced this question (== id). */
  mappingId: string;
}

export interface BuildResult {
  ok: true;
  questions: BuiltQuestion[];
  /** Mapping ids that were applicable but intentionally not patient questions (for logging). */
  staffOnlyNote: string[];
}
export interface BuildError {
  ok: false;
  error: string;
}

/** A usable finite age bound for a question. */
function usableAge(v: number | null): v is number {
  return v !== null && Number.isFinite(v) && v >= 0 && v <= 150;
}

/**
 * Minimum number of server-constructed questions for a usable checklist. We require at least
 * 2: a single question is too thin to be a meaningful "might this fit me?" check and risks
 * presenting a reassuring near-empty list. The hero trial produces 4 (age-min, T2DM, T1DM,
 * hospice), comfortably above the floor. Below the floor we return a safe error so the
 * cautious frontend fallback (its own structured quick-check) takes over instead.
 */
export const MIN_SUPPORTED_QUESTIONS = 2;

/**
 * Build the deterministic checklist for a study + language. Returns the server-constructed
 * questions (text/kind/ruleOutIf/source_criterion all from the mapping, NOT the model) or a
 * BuildError when the study cannot be safely represented.
 */
export function buildChecklist(detail: TrialDetail, lang: Lang): BuildResult | BuildError {
  if (!hasQuestionWording(lang)) {
    return { ok: false, error: `no deterministic question wording for language "${lang}"` };
  }
  const { minAgeYears, maxAgeYears, criteriaText } = detail.eligibility;
  const sections = splitSections(criteriaText ?? "");
  const questions: BuiltQuestion[] = [];

  // --- Age questions, from STRUCTURED bounds only. ---
  const minOk = usableAge(minAgeYears);
  const maxOk = usableAge(maxAgeYears);
  // Conflicting bounds: min > max is nonsensical -> emit NO age question at all.
  const boundsConflict = minOk && maxOk && (minAgeYears as number) > (maxAgeYears as number);
  if (!boundsConflict) {
    for (const am of AGE_MAPPINGS) {
      const value = am.bound === "min" ? minAgeYears : maxAgeYears;
      const ok = am.bound === "min" ? minOk : maxOk;
      if (!ok) continue;
      const text = ageWording(am.bound, value as number, lang);
      if (!text) continue;
      questions.push({
        id: am.id,
        text,
        // Both bounds are inclusion requirements: you must be within the allowed age range;
        // being outside the bound rules you out (answering "no" to "are you within it").
        kind: "inclusion",
        ruleOutIf: "no",
        source_criterion: ageEvidence(am.bound, value as number),
        mappingId: am.id,
      });
    }
  }

  // --- Free-text questions, from supported mappings only. ---
  const staffOnlyNote: string[] = [];
  for (const m of FREE_TEXT_MAPPINGS) {
    const section = m.section === "inclusion" ? sections.inclusion : sections.exclusion;
    const sectionRaw = m.section === "inclusion" ? sections.inclusionRaw : sections.exclusionRaw;
    if (!sectionIncludes(section, m.evidenceMatch)) continue; // fact absent in its section
    const verbatim = extractVerbatim(sectionRaw, m.evidenceMatch);
    if (!verbatim) continue; // cannot extract a single unambiguous evidence line
    // A NEGATED evidence line means the opposite of the mapping's fixed positive wording.
    if (evidenceIsNegated(verbatim)) continue; // fail closed on a negated criterion line
    // If the matched line ITSELF also carries a confusable sibling fact, it is ambiguous.
    if (m.disqualifyIfAlsoMatches?.some((d) => norm(verbatim).includes(norm(d)))) {
      continue; // fail closed on an ambiguous line
    }
    questions.push({
      id: m.id,
      text: m.wording[lang],
      kind: m.section, // FIXED by the mapping's declared section
      ruleOutIf: m.ruleOutIf, // FIXED by the mapping
      source_criterion: verbatim, // VERBATIM from the registry, extracted server-side
      mappingId: m.id,
    });
  }

  if (questions.length < MIN_SUPPORTED_QUESTIONS) {
    return {
      ok: false,
      error: `only ${questions.length} supported question(s) could be constructed; minimum is ${MIN_SUPPORTED_QUESTIONS}`,
    };
  }

  // De-dupe by id (defensive — ids are stable mapping ids and should already be unique).
  const seen = new Set<string>();
  for (const q of questions) {
    if (seen.has(q.id)) return { ok: false, error: `duplicate mapping id "${q.id}"` };
    seen.add(q.id);
  }

  return { ok: true, questions, staffOnlyNote };
}
