// English-requirement detector (pure, deterministic, server-only).
//
// Reads registry eligibility criteria text and reports whether the criteria REQUIRE THE
// PATIENT to use English. The rule is asymmetric: missing a real requirement is acceptable,
// a wrong "required" is not (it would turn away the non-English speakers TrialPath serves).
// So `required` is returned only when the text is unambiguous; everything else fails closed
// to `mentioned` with a reason.
//
// Spec: .kiro/specs/english-requirement-detector/{requirements,design}.md
//
// Sections come ONLY from the shared parser in lib/simplify-mappings.ts (splitSections /
// sectionLines / normalizeLine). That module imports node:crypto, so this module is
// server-only: never import it from a "use client" file. It is not wired to any route or UI
// yet, and `evidence` must not be shown to patients.
//
// No network, clock, randomness, storage or model calls.
import { normalizeLine, sectionLines, splitSections } from "./simplify-mappings";

export type NotRequiredReason = "no-sections" | "other-language-allowed" | "not-about-patient" | "unclear";

export type EnglishRequirement =
  | { status: "required"; evidence: string[] }
  | { status: "mentioned"; reason: NotRequiredReason }
  | { status: "none"; reason: "no-mention" };

type Section = "inclusion" | "exclusion";
type LineClass = "veto" | "subject" | "requirement" | "unclear";

// Whole-word "english" ("New England" / "Englishman" do not match). "Non-English" and
// "English-speaking" do match: the hyphen is a word boundary.
const ENGLISH_RE = /\benglish\b/i;

// --- Vetoes (R3): another language is accepted -------------------------------------------
// All matching runs on normalizeLine() output, which is already lower-cased.
const OTHER_LANGUAGE_RE = new RegExp(
  "\\b(?:" +
    [
      "spanish", "portuguese", "haitian", "creole", "kreyol", "french", "mandarin", "cantonese",
      "chinese", "vietnamese", "russian", "arabic", "korean", "cape verdean", "capeverdean",
      "somali", "japanese", "hindi", "italian", "german", "polish", "greek", "khmer",
      "cambodian", "hmong", "tagalog", "filipino", "bengali", "bangla", "urdu", "farsi",
      "persian", "dari", "pashto", "swahili", "amharic", "tigrinya", "albanian", "armenian",
      "turkish", "hebrew", "thai", "lao", "nepali", "punjabi", "gujarati", "tamil", "telugu",
      "ukrainian", "romanian", "serbian", "croatian", "bosnian", "yoruba", "igbo", "hausa",
      "burmese", "indonesian", "malay", "asl", "bilingual", "multilingual",
      // generic: any plural "languages", or a non-specific language phrase
      "languages", "any language", "preferred language", "sign language", "other language",
    ].join("|") +
    ")\\b",
);
const INTERPRETER_RE = /\b(?:interpret|translat)\w*/;
const PERMISSIVE_RE = new RegExp(
  [
    "\\b(?:welcomed?|welcomes|allowed|permitted|eligible|optional)\\b",
    "\\bnot (?:be )?excluded\\b",
    "\\bnot (?:be )?(?:required|necessary)\\b",
    "\\bnot a requirement\\b",
    "\\b(?:may|can) (?:still )?(?:join|participate|enroll|be enrolled|be included)\\b",
  ].join("|"),
);

// --- Whose English (R4) -------------------------------------------------------------------
const SUBJECT_RE = new RegExp(
  "\\b(?:" +
    [
      "parents?", "caregivers?", "care givers?", "caretakers?", "guardians?", "clinicians?",
      "staff", "providers?", "partners?", "proxy", "proxies", "doulas?", "family", "families",
      "fathers?", "mothers?", "teachers?", "coach", "coaches", "spouses?", "husbands?", "wife",
      "wives", "physicians?", "nurses?", "therapists?", "interventionists?", "surrogates?",
      "informants?", "relatives?", "siblings?", "legally authorized representatives?",
    ].join("|") +
    ")\\b",
);

// --- Polarity (R2.4–R2.6) -----------------------------------------------------------------
const NEGATION_RE = new RegExp(
  [
    "\\bnon[- ]?english\\b",
    "\\b(?:not|no|unable|inability|cannot|lacks?|lacking|poor|poorly|limited|insufficient|inadequate|without|never|neither|nor)\\b",
    "\\bcan not\\b",
    "n['’]t\\b",
    "\\bother than english\\b",
  ].join("|"),
);

function classifyLine(section: Section, normalized: string): LineClass {
  if (OTHER_LANGUAGE_RE.test(normalized)) return "veto";
  if (INTERPRETER_RE.test(normalized)) return "veto";
  if (PERMISSIVE_RE.test(normalized)) return "veto";
  if (SUBJECT_RE.test(normalized)) return "subject";
  const negated = NEGATION_RE.test(normalized);
  if (section === "inclusion" ? !negated : negated) return "requirement";
  return "unclear"; // polarity contradicts the section: never guess
}

/**
 * Decide whether registry criteria require the patient to use English.
 * Pure and total: never throws, for any input.
 */
export function detectEnglishRequirement(criteriaText: string): EnglishRequirement {
  const text = typeof criteriaText === "string" ? criteriaText : "";
  if (!ENGLISH_RE.test(text)) return { status: "none", reason: "no-mention" };

  const sections = splitSections(text);
  if (sections.inclusionRaw === null && sections.exclusionRaw === null) {
    return { status: "mentioned", reason: "no-sections" };
  }

  const lines: { section: Section; original: string; cls: LineClass }[] = [];
  const pairs: [Section, string | null][] = [
    ["inclusion", sections.inclusionRaw],
    ["exclusion", sections.exclusionRaw],
  ];
  for (const [section, raw] of pairs) {
    for (const line of sectionLines(raw)) {
      // sectionLines().normalized is normalizeLine(raw line); re-normalizing is idempotent
      // and keeps this module correct if that field ever changes shape.
      const normalized = normalizeLine(line.normalized);
      if (!ENGLISH_RE.test(normalized)) continue;
      lines.push({ section, original: line.original, cls: classifyLine(section, normalized) });
    }
  }

  // English is mentioned, but not inside any usable section (e.g. only in a preamble).
  if (lines.length === 0) return { status: "mentioned", reason: "unclear" };

  // Strict precedence: veto (study-wide) > unclear > requirement > subject-only.
  if (lines.some((l) => l.cls === "veto")) return { status: "mentioned", reason: "other-language-allowed" };
  if (lines.some((l) => l.cls === "unclear")) return { status: "mentioned", reason: "unclear" };
  const evidence = lines.filter((l) => l.cls === "requirement").map((l) => l.original);
  if (evidence.length > 0) return { status: "required", evidence };
  return { status: "mentioned", reason: "not-about-patient" };
}
