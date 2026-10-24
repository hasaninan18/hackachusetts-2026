// Deterministic condition-name translation for the trial search (no LLM).
//
// ClinicalTrials.gov `query.cond` only understands English terms, so "asma" or
// "diabetes tipo 2" return 0 studies. `toEnglishCondition` maps common condition names in
// Spanish (es), Portuguese (pt) and Haitian Creole (ht) to the English registry term
// before the search URL is built. Matching is on the WHOLE normalized input (lowercase,
// accents and punctuation stripped, spaces collapsed), so partial or unknown text is never
// rewritten: anything not in the table, including English, is returned unchanged.
//
// Pure: no I/O, no clock, no randomness (structure.md).

/**
 * English registry term → phrases that mean it, in their natural spelling (the lookup
 * normalizes them, so accents and case here are only for readability). Phrases that are
 * already valid English (es "hepatitis C", pt "HIV", es "cáncer" → "cancer") are left out
 * on purpose so English input always passes through unchanged.
 */
const TERMS: Readonly<Record<string, readonly string[]>> = {
  "Type 2 Diabetes": [
    "diabetes tipo 2", // es, pt
    "diabetes tipo II",
    "diabetes de tipo 2",
    "diabetes mellitus tipo 2",
    "diabetes mellitus tipo II",
    "dyabèt tip 2", // ht
    "dyabèt tip II",
  ],
  "Type 1 Diabetes": [
    "diabetes tipo 1", // es, pt
    "diabetes tipo I",
    "diabetes de tipo 1",
    "diabetes mellitus tipo 1",
    "diabetes mellitus tipo I",
    "dyabèt tip 1", // ht
    "dyabèt tip I",
  ],
  Diabetes: ["dyabèt"], // ht ("diabetes" is already English)
  Asthma: ["asma", "opresyon"], // es/pt, ht
  Hypertension: [
    "hipertensión", // es
    "hipertensión arterial",
    "presión alta",
    "presión arterial alta",
    "hipertensão", // pt
    "hipertensão arterial",
    "pressão alta",
    "pressão arterial alta",
    "tansyon wo", // ht
    "tansyon",
    "tansyon ateryèl wo",
    "ipètansyon",
  ],
  "Breast Cancer": [
    "cáncer de mama", // es; pt "câncer de mama" normalizes the same
    "cáncer de seno", // es
    "câncer da mama", // pt
    "kansè tete", // ht
    "kansè nan tete",
  ],
  "Lung Cancer": [
    "cáncer de pulmón", // es
    "cáncer pulmonar", // es; pt "câncer pulmonar"
    "câncer de pulmão", // pt
    "câncer do pulmão",
    "kansè poumon", // ht
    "kansè nan poumon",
  ],
  "Colon Cancer": [
    "cáncer de colon", // es; pt "câncer de cólon"
    "câncer do cólon", // pt
    "kansè kolon", // ht
    "kansè nan kolon",
  ],
  "Colorectal Cancer": [
    "cáncer colorrectal", // es
    "câncer colorretal", // pt
    "kansè kolorektal", // ht
  ],
  "Prostate Cancer": [
    "cáncer de próstata", // es, pt
    "câncer da próstata", // pt
    "kansè pwostat", // ht
    "kansè nan pwostat",
  ],
  Cancer: ["kansè"], // ht
  Depression: ["depresión", "depressão", "depresyon"], // es, pt, ht
  Anxiety: ["ansiedad", "ansiedade", "anksyete", "enkyetid"], // es, pt, ht
  Obesity: ["obesidad", "obesidade", "obezite"], // es, pt, ht
  "Heart Disease": [
    "enfermedad del corazón", // es
    "enfermedades del corazón",
    "enfermedad cardíaca",
    "enfermedades cardíacas",
    "cardiopatía", // es, pt
    "doença cardíaca", // pt
    "doenças cardíacas",
    "doença do coração",
    "doenças do coração",
    "maladi kè", // ht
  ],
  "Heart Failure": [
    "insuficiencia cardíaca", // es
    "falla cardíaca",
    "insuficiência cardíaca", // pt
    "ensifizans kadyak", // ht
  ],
  Stroke: [
    "derrame cerebral", // es, pt
    "accidente cerebrovascular", // es
    "ictus",
    "acidente vascular cerebral", // pt
    "konjesyon serebral", // ht
    "atak serebral",
  ],
  COPD: [
    "EPOC", // es
    "enfermedad pulmonar obstructiva crónica",
    "DPOC", // pt
    "doença pulmonar obstrutiva crônica",
    "BPCO", // ht
  ],
  HIV: ["VIH", "VIH/SIDA"], // es, ht (pt "HIV" is already English)
  AIDS: ["SIDA"], // es, ht
  "Hepatitis C": ["hepatite C", "epatit C"], // pt, ht (es "hepatitis C" is already English)
  "Sickle Cell Disease": [
    "anemia de células falciformes", // es
    "anemia falciforme", // es, pt
    "enfermedad de células falciformes",
    "drepanocitosis",
    "doença falciforme", // pt
    "anemi falsifòm", // ht
    "drepanositoz",
  ],
  "Alzheimer Disease": [
    "Alzheimer", // es, pt, ht
    "enfermedad de Alzheimer", // es
    "mal de Alzheimer", // es, pt
    "doença de Alzheimer", // pt
    "maladi Alzheimer", // ht
  ],
  Arthritis: ["artritis", "artrite", "atrit"], // es, pt, ht
  "Rheumatoid Arthritis": ["artritis reumatoide", "artrite reumatoide", "atrit rimatoyid"],
  "Kidney Disease": [
    "enfermedad renal", // es
    "enfermedad de los riñones",
    "doença renal", // pt
    "doença dos rins",
    "maladi ren", // ht
  ],
  "Chronic Kidney Disease": [
    "enfermedad renal crónica", // es
    "doença renal crônica", // pt
    "maladi ren kwonik", // ht
  ],
  "Kidney Failure": ["insuficiencia renal", "insuficiência renal"], // es, pt
  "Long COVID": [
    "COVID prolongado", // es, pt
    "COVID persistente", // es
    "COVID largo",
    "COVID longa", // pt
    "COVID longo",
    "COVID long", // ht
  ],
};

/**
 * Normalize a condition string for lookup: strip accents (ñ → n, ç → c), lowercase,
 * drop apostrophes, turn any other punctuation into a space, collapse whitespace and trim.
 * Never throws.
 */
export function normalizeCondition(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Normalized phrase → English registry term, built once from {@link TERMS}. */
const LOOKUP: ReadonlyMap<string, string> = new Map(
  Object.entries(TERMS).flatMap(([english, phrases]) =>
    phrases.map((phrase) => [normalizeCondition(phrase), english] as const),
  ),
);

/** Every mapping as `[source phrase as written, English term]`, for tests. */
export const CONDITION_TERMS: readonly (readonly [string, string])[] = Object.entries(
  TERMS,
).flatMap(([english, phrases]) => phrases.map((phrase) => [phrase, english] as const));

/**
 * Translate a common condition name in Spanish, Portuguese or Haitian Creole to the English
 * term ClinicalTrials.gov `query.cond` expects. Case, accents and punctuation are ignored.
 * Unknown input (including English) is returned exactly as given.
 */
export function toEnglishCondition(input: string): string {
  return LOOKUP.get(normalizeCondition(input)) ?? input;
}
