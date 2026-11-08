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
    // hedged or conditional: English is preferred, or has an exception / accommodation
    "\\b(?:preferred|preferably|preferable|ideally|encouraged|unless|except)\\b",
    "\\bif possible\\b",
    "\\baccommodat\\w*",
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

function isVeto(normalized: string): boolean {
  return OTHER_LANGUAGE_RE.test(normalized) || INTERPRETER_RE.test(normalized) || PERMISSIVE_RE.test(normalized);
}

// --- Clauses and tokens (R2.4, R2.5, R2.8) -----------------------------------------------
// Scope rules work on clauses (a line split at . ; ! ? followed by a space or the end) and on
// word tokens (letters, digits, apostrophes; "non-english" is two tokens). Matching words in
// one sentence never combine with words in another sentence of the same line.
function clausesOf(normalized: string): string[][] {
  return normalized
    .split(/[.;!?]+(?=\s|$)/)
    .map((clause) => clause.split(/[^a-z0-9'’]+/).filter((t) => t.length > 0))
    .filter((tokens) => tokens.length > 0);
}

// --- Language ability (R2.8) ----------------------------------------------------------------
// A requirement must say the PATIENT speaks / reads / writes / understands English. Only words
// about language use count. "able" / "ability" do NOT count on their own: they say the patient
// can do something, not that it is language ("Able to attend all visits"). "written", "consent"
// and a bare "language" do not count either, because they describe documents.
const ABILITY_TOKENS = new Set([
  "speak", "speaks", "speaking", "speaker", "speakers", "spoke", "spoken",
  "read", "reads", "reading", "write", "writes", "writing",
  "understand", "understands", "understanding", "understood", "comprehend", "comprehends", "comprehension",
  "fluent", "fluency", "fluently", "nonfluent", "proficient", "proficiency",
  "literate", "literacy", "illiterate", "illiteracy",
  "converse", "conversing", "conversant", "communicate", "communicating", "communication",
]);
// The ability word and "english" must be in the same clause and at most this many tokens
// apart. 10 is the smallest window that keeps fixture real-line-05 ("Ability to understand
// and provide a signed and completed consent document in English": understand … english = 10).
const ABILITY_WINDOW = 10;

// --- Negation (R2.5, R2.6) ------------------------------------------------------------------
// Inability words ("illiterate", "non-fluent", "non-English") are negations too.
const NEGATION_TOKENS = new Set([
  "not", "no", "non", "unable", "inability", "cannot", "lack", "lacks", "lacking", "poor", "poorly",
  "limited", "insufficient", "inadequate", "without", "never", "neither", "nor",
  "illiterate", "illiteracy", "nonfluent", "nonenglish",
]);
const isNegationToken = (t: string): boolean => NEGATION_TOKENS.has(t) || /n['’]t$/.test(t);
// In exclusion, a negation only says "lacks English" when it is BOUND to the English word or
// to an ability word in scope of it:
//   - BEFORE it: at most NEGATION_WINDOW tokens earlier, with no clause-joining word in
//     between ("unable to speak English", "not proficient in English", "non-English");
//   - AFTER it: only as a predicate, i.e. directly after it or after a single copula
//     ("English proficiency is limited", "English is not ...").
// 2 is the smallest window that keeps the fixtures ("unable to speak", "inability to
// comprehend", "unable to read or write"). This keeps "English-speaking patients with no /
// without prior treatment" from reading the treatment negation as a language one.
const NEGATION_WINDOW = 2;
const BARRIER_TOKENS = new Set([
  "with", "who", "whom", "whose", "which", "that", "and", "or", "but", "if", "when", "while", "because", "for",
]);
const COPULA_TOKENS = new Set(["is", "are", "was", "were", "be", "been"]);
// Only these can follow English as a predicate. "no" / "without" after English start a new
// phrase ("English speaking without prior surgery") and never negate it.
const PREDICATE_NEGATION_TOKENS = new Set(["not", "limited", "poor", "insufficient", "inadequate", "lacking"]);
const isPredicateNegation = (t: string): boolean => PREDICATE_NEGATION_TOKENS.has(t) || /n['’]t$/.test(t);

function isOtherThanEnglish(tokens: string[], i: number): boolean {
  return tokens[i] === "english" && tokens[i - 1] === "than" && tokens[i - 2] === "other";
}

interface ClauseFacts {
  ability: boolean; // a language-ability word in scope of "english", or "other than english"
  boundNegation: boolean; // a negation bound to "english" or to that ability word
}

// Linear in the clause length: each check looks at a fixed-size neighbourhood.
function clauseFacts(tokens: string[]): ClauseFacts {
  const len = tokens.length;
  // Distance from each token to the nearest "english" (two passes).
  const dist = new Array<number>(len).fill(Infinity);
  for (let i = 0, last = -Infinity; i < len; i++) {
    if (tokens[i] === "english") last = i;
    dist[i] = i - last;
  }
  for (let i = len - 1, next = Infinity; i >= 0; i--) {
    if (tokens[i] === "english") next = i;
    dist[i] = Math.min(dist[i], next - i);
  }
  if (!tokens.includes("english")) return { ability: false, boundNegation: false };
  // "Language other than English": the patient's language is not English (ability + negation).
  if (tokens.some((_t, i) => isOtherThanEnglish(tokens, i))) return { ability: true, boundNegation: true };

  // Targets: "english" itself, and language-ability words within ABILITY_WINDOW of it.
  const isTarget = tokens.map(
    (t, i) => t === "english" || (ABILITY_TOKENS.has(t) && dist[i] <= ABILITY_WINDOW),
  );
  const ability = tokens.some((t, i) => isTarget[i] && t !== "english");
  if (!ability) return { ability: false, boundNegation: false };

  const boundNegation = tokens.some((t, n) => {
    if (!isNegationToken(t)) return false;
    if (isTarget[n]) return true; // the word is both: "illiterate", "nonfluent"
    // Before a target: within NEGATION_WINDOW, no clause-joining word in between.
    for (let k = n + 1; k <= n + NEGATION_WINDOW && k < len; k++) {
      if (isTarget[k]) return true;
      if (BARRIER_TOKENS.has(tokens[k])) break;
    }
    // After a target: only a predicate, "english limited" / "english <copula> limited".
    if (!isPredicateNegation(t)) return false;
    return (n >= 1 && isTarget[n - 1]) || (n >= 2 && COPULA_TOKENS.has(tokens[n - 1]) && isTarget[n - 2]);
  });
  return { ability: true, boundNegation };
}

function classifyLine(section: Section, normalized: string): LineClass {
  if (isVeto(normalized)) return "veto";
  if (SUBJECT_RE.test(normalized)) return "subject";
  const clauses = clausesOf(normalized);
  const facts = clauses.map(clauseFacts);
  // English named, but no patient language ability stated in the same clause.
  if (!facts.some((f) => f.ability)) return "unclear";
  if (section === "inclusion") {
    // Inclusion stays strict: ANY negation anywhere on the line makes it unclear.
    const negatedAnywhere = clauses.some(
      (tokens) => tokens.some(isNegationToken) || tokens.some((_t, i) => isOtherThanEnglish(tokens, i)),
    );
    return negatedAnywhere ? "unclear" : "requirement";
  }
  // Exclusion: a requirement only when the negation is bound to the English ability.
  return facts.some((f) => f.ability && f.boundNegation) ? "requirement" : "unclear";
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

  // Vetoes are study-wide (R3.4): check every English line in the WHOLE text, including text
  // before the first heading. This is a plain line split, not a heading parser; requirement
  // evidence below still comes only from the shared parser's sections.
  for (const raw of text.split(/\r?\n/)) {
    const normalized = normalizeLine(raw);
    if (ENGLISH_RE.test(normalized) && isVeto(normalized)) {
      return { status: "mentioned", reason: "other-language-allowed" };
    }
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
