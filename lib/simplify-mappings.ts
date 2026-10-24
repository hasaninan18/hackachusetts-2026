// DEFAULT-DENY mapping registry for the simplify checklist (spec: simplify) — SDK-FREE.
//
// WHY THIS MODULE EXISTS (the production semantic-safety redesign):
// The previous validator was DEFAULT-ALLOW: it accepted any model-authored question and
// only rejected the specific mismatches it had been taught. The first fix moved question
// construction to the SERVER from a finite set of supported, deterministic
// criterion->question mappings. But that fix still matched the registry by SUBSTRING
// (sectionIncludes + extractVerbatim over an `evidenceMatch`). A SUBSTRING match cannot tell
// a reviewed line from an altered one that merely CONTAINS the substring, so an edited
// registry line like "Patients not currently receiving hospice care." still produced
// "Are you currently receiving hospice care?" — the OPPOSITE meaning.
//
// THE FINAL FIX (this module): free-text mappings are now STUDY-PINNED and EXACT-LINE.
// A mapping fires ONLY IF, all of:
//   (1) detail.nctId (normalized, upper-cased) === mapping.nctId; AND
//   (2) the study's criteria-revision hash equals the REVIEWED hash stored for that study
//       (so an edited registry — any line changed/added/removed — builds NO free-text
//       questions and emits one structured "criteria-revision-changed" warning); AND
//   (3) the mapping's DECLARED section (from the explicit-heading splitSections; a missing
//       or ambiguous heading still means NO section) splits into lines and EXACTLY ONE line,
//       after normalization, is EQUAL (===, not substring) to the mapping's `exactLine`.
// Zero or more than one equal line means no question. Any changed, extra-word, negated,
// reordered, merged, or unsupported line is therefore rejected WITHOUT any negation/keyword
// regex: it simply is not character-for-character the reviewed line.
//
// kind, ruleOutIf, and the en/es wording are FIXED server-side (never from the model).
// source_criterion is the ORIGINAL matched registry line (bullet marker stripped, original
// casing and punctuation preserved), not the normalized form.
//
// This module is PURE and SDK-FREE so it unit-tests without Bedrock and never drags the AWS
// SDK into any bundle. It uses node:crypto for SHA-256 (synchronous, server-only — no "use
// client" file imports this module, directly or transitively; verified by grep + build).
// lib/bedrock.ts calls buildChecklist() during orchestration; lib/simplify-semantics.ts
// re-uses the normalizer + splitter + exact-line matcher as the single authority.
import { createHash } from "node:crypto";
import type { Lang } from "./types";
import type { TrialDetail } from "./types";
import type { SimplifyQuestion } from "./bedrock-types";

// ---------------------------------------------------------------------------
// Supported languages for DETERMINISTIC question wording.
// ---------------------------------------------------------------------------
// Question MEANING and rule-out logic are fixed server-side; only the surface wording is
// localized, and ONLY from handwritten strings here. We ship deterministic wording for en
// and es (the hero languages). For pt/ht/zh/vi we FAIL CLOSED. The summary/whatYouDo/etc.
// PROSE may still be model-translated, but the CHECKLIST itself is en/es only.
export type WordingLang = "en" | "es";
export const QUESTION_WORDING_LANGS = ["en", "es"] as const satisfies readonly WordingLang[];

/** True when we have deterministic, reviewed question wording for a language. */
export function hasQuestionWording(lang: Lang): lang is WordingLang {
  return (QUESTION_WORDING_LANGS as readonly string[]).includes(lang);
}

// ---------------------------------------------------------------------------
// The ONE line normalizer — used EVERYWHERE (construction, hashing, backstop).
// ---------------------------------------------------------------------------
// Steps, in order:
//   1. strip a single leading bullet marker (*, -, •) and the spaces around it;
//   2. collapse all internal whitespace runs to a single space;
//   3. trim;
//   4. case-fold (lower-case).
// Exact-line matching compares `normalizeLine(a) === normalizeLine(b)`. A line that differs
// by a single word, a negation, punctuation that changes a word, or merged content will NOT
// be equal, so it is rejected. (Note: this intentionally does NOT strip punctuation — a
// trailing "." is part of the line and must match.)
export function normalizeLine(s: string): string {
  return s
    .replace(/^\s*[*\-•]\s*/, "") // strip a leading bullet marker
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Legacy name kept for back-compat callers that normalized a whole blob (section text). It
// is the SAME transform minus bullet stripping; still used only for section-level views, not
// for gating free-text questions.
/** Collapse whitespace, lower-case, trim. */
export function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Section splitting — the SINGLE authority on inclusion/exclusion headings.
// ---------------------------------------------------------------------------
// A mapping may only match a fact inside the section it declares, and only when that section
// is UNAMBIGUOUSLY delimited by an explicit heading. We deliberately do NOT fall back to
// "treat everything as inclusion": a criteria block with no usable headings yields NO usable
// sections, so free-text mappings cannot match and the study fails closed.
const INCLUSION_HEADER_RE = /\binclusion\s+criteria\b\s*:?/i;
const EXCLUSION_HEADER_RE = /\bexclusion\s+criteria\b\s*:?/i;

export interface CriteriaSections {
  /** Normalized inclusion-section text, or null when it cannot be unambiguously located. */
  inclusion: string | null;
  /** Normalized exclusion-section text, or null when it cannot be unambiguously located. */
  exclusion: string | null;
  /** The raw (un-normalized) inclusion slice, for exact-line extraction. */
  inclusionRaw: string | null;
  /** The raw (un-normalized) exclusion slice, for exact-line extraction. */
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
// Exact-line extraction — the heart of the final fix.
// ---------------------------------------------------------------------------
// A section's RAW slice is split into lines. The explicit heading line (the "Inclusion
// Criteria:" / "Exclusion Criteria:" marker) and any blank line is dropped. We keep the
// ORIGINAL line (only the leading bullet marker stripped and surrounding whitespace trimmed)
// so source_criterion preserves the registry's casing/punctuation, alongside its normalized
// form for equality testing.
interface SectionLine {
  original: string; // bullet stripped + trimmed, original casing/punctuation
  normalized: string; // normalizeLine(original)
}

/** The explicit heading lines we must never treat as a criterion line. */
function isHeadingLine(normalized: string): boolean {
  return INCLUSION_HEADER_RE.test(normalized) || EXCLUSION_HEADER_RE.test(normalized);
}

/** Split a raw section slice into criterion lines (headings + blanks dropped). */
export function sectionLines(sectionRaw: string | null): SectionLine[] {
  if (sectionRaw === null) return [];
  const out: SectionLine[] = [];
  for (const raw of sectionRaw.split(/\r?\n/)) {
    const original = raw.replace(/^\s*[*\-•]\s*/, "").trim();
    if (original.length === 0) continue; // drop blank lines
    const normalized = normalizeLine(raw);
    if (normalized.length === 0) continue;
    if (isHeadingLine(normalized)) continue; // drop the section heading itself
    out.push({ original, normalized });
  }
  return out;
}

/**
 * Find the SINGLE criterion line in `sectionRaw` whose normalized form EQUALS
 * `normalizeLine(exactLine)`. Returns the ORIGINAL (un-normalized, bullet-stripped) line, or
 * null when zero or more than one line is equal (fail closed). This is the exact-line rule.
 */
export function matchExactLine(sectionRaw: string | null, exactLine: string): string | null {
  const target = normalizeLine(exactLine);
  if (!target) return null;
  const hits = sectionLines(sectionRaw).filter((l) => l.normalized === target);
  if (hits.length !== 1) return null; // zero or ambiguous -> no question
  return hits[0].original;
}

// ---------------------------------------------------------------------------
// Criteria-revision hash — SHA-256 over the canonical normalized criteria.
// ---------------------------------------------------------------------------
// CANONICAL INPUT (documented precisely so it is reproducible):
//   - Take splitSections(criteriaText).{inclusionRaw, exclusionRaw}.
//   - For each present section, in the FIXED order [inclusion, exclusion]:
//       * emit the literal section name line: "inclusion criteria:" or "exclusion criteria:";
//       * then emit each criterion line of that section via sectionLines() (headings and
//         blank lines already dropped), normalized with normalizeLine(), in document order.
//   - A section whose raw slice is null (missing/ambiguous heading) contributes NOTHING
//     (neither its name nor any line).
//   - Join every emitted line with a single "\n". No trailing newline.
// SHA-256 of the UTF-8 bytes of that string, hex-encoded, lower-case.
//
// Because the input is the NORMALIZED lines plus the section NAMES, any edit to a reviewed
// line (word change, negation, extra/removed line, moved between sections) changes the hash.
// Pure whitespace/case/bullet-only reformatting does NOT change it (normalizeLine folds it).
export function canonicalCriteriaInput(criteriaText: string): string {
  const s = splitSections(criteriaText ?? "");
  const parts: string[] = [];
  if (s.inclusionRaw !== null) {
    parts.push("inclusion criteria:");
    for (const l of sectionLines(s.inclusionRaw)) parts.push(l.normalized);
  }
  if (s.exclusionRaw !== null) {
    parts.push("exclusion criteria:");
    for (const l of sectionLines(s.exclusionRaw)) parts.push(l.normalized);
  }
  return parts.join("\n");
}

/** SHA-256 (hex, lower-case) of the canonical normalized criteria. Synchronous. */
export function criteriaRevisionHash(criteriaText: string): string {
  return createHash("sha256").update(canonicalCriteriaInput(criteriaText), "utf8").digest("hex");
}

/**
 * The REVIEWED criteria-revision hash per NCT id. Computed from the LIVE
 * ClinicalTrials.gov v2 record on the date of review (see FINAL REPORT for derivation). If a
 * study's live hash no longer equals the value here, the registry was revised and we build
 * NO free-text questions for it (one structured warning is emitted).
 */
export const REVIEWED_CRITERIA_HASH: Record<string, string> = {
  // SHA-256 of canonicalCriteriaInput() over the LIVE NCT07043426 ClinicalTrials.gov v2
  // record (fetched read-only during this change). Recompute with
  // criteriaRevisionHash(detail.eligibility.criteriaText).
  NCT07043426: "694f6bdf6caa43d5cd491a72bcb995ab8d97c0f3fc459580a5c7b4bff77b32e0",
};

/** Normalize an NCT id for comparison (trim + upper-case). */
export function normNctId(nctId: string): string {
  return (nctId ?? "").trim().toUpperCase();
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
  /** The study this mapping is pinned to (normalized, upper-case). */
  nctId: string;
  /** The section this fact MUST live in, from explicit headings. */
  section: Section;
  /**
   * The FULL reviewed registry bullet text this mapping requires. A mapping fires only when
   * EXACTLY ONE line in its declared section is EQUAL to this after normalizeLine(). Stored
   * as the full reviewed text for readability; it is normalized before comparison.
   */
  exactLine: string;
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
 * a deterministic, reviewed, STUDY-PINNED, EXACT-LINE criterion->question mapping.
 *
 * For NCT07043426 (THRIVE-DM, BMC) the reviewed registry criteria (confirmed live,
 * character-for-character) are:
 *   Inclusion:
 *     * Diagnosis: Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM), ...   -> SUPPORTED
 *     * Uncontrolled T2DM: Must have an HbA1c ≥9% at the time of screening.        -> NOT supported
 *     * Health-Related Social Needs: Must have been screened ... GIM visit ...     -> NOT supported
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
    nctId: "NCT07043426",
    section: "inclusion",
    exactLine:
      "Diagnosis: Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM), confirmed by a current diagnosis in the medical record or at least two billing codes in the last two years, or an HbA1c level ≥6.5% in the last two years.",
    ruleOutIf: "no", // inclusion: failing it (answering "no") rules you out
    wording: {
      en: "Do you have type 2 diabetes?",
      es: "¿Tiene diabetes tipo 2?",
    },
  },
  {
    kind: "free_text",
    id: "t1dm_exclusion",
    nctId: "NCT07043426",
    section: "exclusion",
    exactLine: "Patients with Type 1 Diabetes Mellitus (T1DM).",
    ruleOutIf: "yes", // exclusion: meeting it (answering "yes") rules you out
    wording: {
      en: "Do you have type 1 diabetes?",
      es: "¿Tiene diabetes tipo 1?",
    },
  },
  {
    kind: "free_text",
    id: "hospice",
    nctId: "NCT07043426",
    section: "exclusion",
    exactLine: "Patients receiving hospice care.",
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
 * 2: a single question is too thin to be a meaningful "might this fit me?" check. The hero
 * trial produces 4 (age-min, T2DM, T1DM, hospice). Below the floor we return a safe error so
 * the cautious frontend fallback (its own structured quick-check) takes over instead.
 */
export const MIN_SUPPORTED_QUESTIONS = 2;

/** Stable tag for the one structured warning emitted when a study's criteria were revised. */
export const CRITERIA_REVISION_WARNING = "criteria-revision-changed";

/**
 * Decide whether free-text questions may be built for a study: the study must be known (have
 * a reviewed hash) AND its live criteria hash must still equal the reviewed one. On a
 * mismatch we emit ONE structured warning (tag + nctId + hash PREFIXES only — never criteria
 * text or patient data) and return false. Unknown studies simply return false, no warning.
 */
export function freeTextAllowedForStudy(
  detail: TrialDetail,
  warn: (msg: string) => void = (m) => console.warn(m),
): boolean {
  const nct = normNctId(detail.nctId);
  const expected = REVIEWED_CRITERIA_HASH[nct];
  if (!expected) return false; // unknown study -> no free-text, no warning
  const actual = criteriaRevisionHash(detail.eligibility.criteriaText ?? "");
  if (actual === expected) return true;
  // Structured, data-free warning (prefixes only).
  warn(
    `${CRITERIA_REVISION_WARNING} nctId=${nct} expected=${expected.slice(0, 12)} actual=${actual.slice(0, 12)}`,
  );
  return false;
}

/**
 * Build the deterministic checklist for a study + language. Returns the server-constructed
 * questions (text/kind/ruleOutIf/source_criterion all from the mapping, NOT the model) or a
 * BuildError when the study cannot be safely represented.
 *
 * `warn` is injectable for tests; it defaults to console.warn.
 */
export function buildChecklist(
  detail: TrialDetail,
  lang: Lang,
  warn: (msg: string) => void = (m) => console.warn(m),
): BuildResult | BuildError {
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

  // --- Free-text questions, STUDY-PINNED + EXACT-LINE + HASH-GATED. ---
  // Gate ALL free-text construction behind the study pin + criteria-revision hash. A study
  // that is unknown, or whose criteria were revised, contributes NO free-text questions.
  const staffOnlyNote: string[] = [];
  const nct = normNctId(detail.nctId);
  if (freeTextAllowedForStudy(detail, warn)) {
    for (const m of FREE_TEXT_MAPPINGS) {
      if (m.nctId !== nct) continue; // not this study's mapping
      const sectionRaw =
        m.section === "inclusion" ? sections.inclusionRaw : sections.exclusionRaw;
      // EXACTLY ONE line in the declared section must EQUAL the reviewed exactLine.
      const original = matchExactLine(sectionRaw, m.exactLine);
      if (original === null) continue; // zero/ambiguous/altered -> no question
      questions.push({
        id: m.id,
        text: m.wording[lang],
        kind: m.section, // FIXED by the mapping's declared section
        ruleOutIf: m.ruleOutIf, // FIXED by the mapping
        source_criterion: original, // ORIGINAL registry line (bullet stripped, casing kept)
        mappingId: m.id,
      });
    }
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
