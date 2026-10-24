// Unit + pipeline tests for lib/bedrock.ts under the DEFAULT-DENY redesign (spec: simplify).
// No network, no live SDK: the Converse transport is INJECTED as a plain function. The
// model authors ONLY prose; the server builds the checklist from lib/simplify-mappings.ts,
// so a model that tries to inject its own questions/kind/ruleOutIf can never surface them.
import { describe, expect, it } from "vitest";
import type { TrialDetail } from "./types";
import {
  BEDROCK_TOTAL_BUDGET_MS,
  CLIENT_TIMEOUT_FLOOR_MS,
  PER_CALL_TIMEOUT_MS,
  SERVER_TOTAL_BUDGET_MS,
  STUDY_LOAD_BUDGET_MS,
  buildEnglishProsePrompt,
  buildProseTranslatePrompt,
  checkProseTranslationInvariants,
  extractProtectedValues,
  generateSimplified,
  parseLang,
  parseNct,
  toResponseBody,
  validateProseOutput,
  assembleModel,
  type Converse,
  type SimplifyModel,
  type SimplifyProse,
} from "./bedrock";

// ---------------------------------------------------------------------------
// Fixtures — the REAL NCT07043426 criteria (verbatim from ClinicalTrials.gov v2).
// ---------------------------------------------------------------------------
const HERO_CRITERIA = [
  "Inclusion Criteria:",
  "",
  "* Diagnosis: Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM), confirmed by a current diagnosis in the medical record or at least two billing codes in the last two years, or an HbA1c level ≥6.5% in the last two years.",
  "* Uncontrolled T2DM: Must have an HbA1c ≥9% at the time of screening.",
  "* Health-Related Social Needs: Must have been screened for health related social needs (HRSNs) during a General Internal Medicine (GIM) visit in the last 3 months and screened positive for at least one HRSN.",
  "",
  "Exclusion Criteria:",
  "",
  "* Patients enrolled in Complex Care Management (CCM).",
  "* Patients receiving hospice care.",
  "* Patients who are deceased",
  "* Patients with Type 1 Diabetes Mellitus (T1DM).",
].join("\n");

const DETAIL: TrialDetail = {
  nctId: "NCT07043426",
  title: "THRIVE-DM at Boston Medical Center",
  conditions: ["Type 2 Diabetes"],
  phase: "Phase 2",
  nearestSite: { name: "Boston Medical Center", city: "Boston", lat: 42.335, lon: -71.0728, locationPrecision: "facility" },
  distanceMi: 0,
  briefSummary: "A diabetes study. Call 617-555-0100 or email team@bmc.org.",
  eligibility: {
    minAgeYears: 18,
    maxAgeYears: null,
    sex: "ALL",
    healthyVolunteers: false,
    criteriaText: HERO_CRITERIA,
  },
  sites: [{ name: "Boston Medical Center", city: "Boston", lat: 42.335, lon: -71.0728, locationPrecision: "facility" }],
  contacts: [{ name: "Study Team", phone: "617-555-0100", email: "team@bmc.org" }],
  stops: [],
};

function validProse(overrides: Partial<SimplifyProse> = {}): SimplifyProse {
  return {
    summary:
      "This study at Boston Medical Center looks at type 2 diabetes care. You may be put by chance in a group that gets usual care. Taking part is your choice.",
    whatYouDo: "You visit the clinic and answer questions about your health.",
    timeCommitment: "About 4 visits over 6 months.",
    staff_checks: ["The study team will check your lab results."],
    ...overrides,
  };
}
function proseJson(overrides: Partial<SimplifyProse> = {}): string {
  return JSON.stringify(validProse(overrides));
}

const SOURCE = extractProtectedValues(
  [DETAIL.nctId, DETAIL.briefSummary, DETAIL.eligibility.criteriaText, "617-555-0100 team@bmc.org"].join("\n"),
);

// ---------------------------------------------------------------------------
describe("parseNct", () => {
  it("normalizes valid ids", () => {
    expect(parseNct(" nct07043426 ")).toBe("NCT07043426");
    expect(parseNct("NCT00000001")).toBe("NCT00000001");
  });
  it("rejects invalid ids", () => {
    expect(parseNct("NCT123")).toBeNull();
    expect(parseNct("ABC07043426")).toBeNull();
    expect(parseNct(123)).toBeNull();
    expect(parseNct(undefined)).toBeNull();
  });
});

describe("parseLang", () => {
  it("accepts supported languages only", () => {
    for (const l of ["en", "es", "pt", "ht", "zh", "vi"]) expect(parseLang(l)).toBe(l);
    expect(parseLang("fr")).toBeNull();
    expect(parseLang("")).toBeNull();
    expect(parseLang(5)).toBeNull();
  });
});

describe("extractProtectedValues", () => {
  it("pulls ncts, phones, and emails", () => {
    const pv = extractProtectedValues("NCT07043426 call 617-555-0100 or team@bmc.org");
    expect(pv.ncts).toEqual(["NCT07043426"]);
    expect(pv.emails).toEqual(["team@bmc.org"]);
    expect(pv.phones.map((p) => p.replace(/\D/g, ""))).toContain("6175550100");
  });
});

describe("validateProseOutput — shape", () => {
  it("accepts valid prose", () => {
    const r = validateProseOutput(proseJson(), { lang: "en", source: SOURCE });
    expect(r.ok).toBe(true);
  });
  it("rejects non-JSON and non-object", () => {
    expect(validateProseOutput("not json", { lang: "en", source: SOURCE }).ok).toBe(false);
    expect(validateProseOutput("[]", { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects missing required prose fields", () => {
    expect(validateProseOutput(proseJson({ summary: "" }), { lang: "en", source: SOURCE }).ok).toBe(false);
    expect(validateProseOutput(proseJson({ whatYouDo: "" }), { lang: "en", source: SOURCE }).ok).toBe(false);
    expect(validateProseOutput(proseJson({ timeCommitment: "" }), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects an over-long summary (> 80 words)", () => {
    const long = Array.from({ length: 90 }, () => "word").join(" ");
    expect(validateProseOutput(proseJson({ summary: long }), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("IGNORES any questions the model tries to author (they never reach the response)", () => {
    const raw = JSON.stringify({
      ...validProse(),
      questions: [{ id: "x", text: "Do you have asthma?", ruleOutIf: "no", source_criterion: "made up", kind: "inclusion" }],
    });
    const r = validateProseOutput(raw, { lang: "en", source: SOURCE });
    expect(r.ok).toBe(true);
    // The validated prose carries no questions field at all.
    expect((r as { ok: true; value: SimplifyProse }).value).not.toHaveProperty("questions");
  });
});

describe("validateProseOutput — safety", () => {
  it("rejects forbidden phrases (per language)", () => {
    expect(validateProseOutput(proseJson({ whatYouDo: "You qualify for this trial." }), { lang: "en", source: SOURCE }).ok).toBe(false);
    expect(validateProseOutput(proseJson({ whatYouDo: "Usted es elegible." }), { lang: "es", source: SOURCE }).ok).toBe(false);
  });
  it("rejects a new phone not present in the source", () => {
    expect(validateProseOutput(proseJson({ whatYouDo: "Call 617-555-9999 now." }), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
});

describe("prompt builders", () => {
  it("English prose prompt embeds the data block and asks for prose only", () => {
    const p = buildEnglishProsePrompt(DETAIL);
    expect(p.user).toContain("<STUDY_DATA>");
    expect(p.user).toContain("No questions.");
    expect(p.system).toContain("You do NOT write any screening questions");
  });
  it("translate prompt forbids adding numbers and keeps keys", () => {
    const p = buildProseTranslatePrompt(proseJson(), "es");
    expect(p.system).toContain("usted");
    expect(p.system).toContain("Do NOT add or remove any number");
  });
});

describe("checkProseTranslationInvariants", () => {
  const en = validProse();
  it("accepts a faithful translation", () => {
    const tr = validProse({ summary: "Estudio en Boston Medical Center sobre diabetes tipo 2. Participar es su elección." });
    expect(checkProseTranslationInvariants(en, tr)).toBeNull();
  });
  it("rejects a translation that introduces a NEW number", () => {
    const tr = validProse({ timeCommitment: "Unas 4 visitas durante 12 meses." }); // 12 not in English (6)
    expect(checkProseTranslationInvariants(en, tr)).not.toBeNull();
  });
});

describe("toResponseBody / assembleModel", () => {
  it("mirrors summary into whatItStudies and carries lang + questions", () => {
    const model: SimplifyModel = assembleModel(validProse(), [
      { id: "age_min", text: "Are you at least 18 years old?", ruleOutIf: "no", source_criterion: "minimumAge = 18 years", kind: "inclusion" },
      { id: "t2dm_diagnosis", text: "Do you have type 2 diabetes?", ruleOutIf: "no", source_criterion: "x", kind: "inclusion" },
    ]);
    const body = toResponseBody(model, "es");
    expect(body.lang).toBe("es");
    expect(body.whatItStudies).toBe(model.summary);
    expect(body.questions).toHaveLength(2);
  });
});

describe("budget math constants", () => {
  it("are internally consistent", () => {
    expect(SERVER_TOTAL_BUDGET_MS).toBe(STUDY_LOAD_BUDGET_MS + BEDROCK_TOTAL_BUDGET_MS);
    expect(CLIENT_TIMEOUT_FLOOR_MS).toBeGreaterThanOrEqual(SERVER_TOTAL_BUDGET_MS);
    expect(PER_CALL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline (converse injected). The server builds the hero checklist; the mocked
// model returns only prose.
// ---------------------------------------------------------------------------
describe("generateSimplified — English success with server-built checklist", () => {
  it("returns server questions (not model's) and model prose", async () => {
    const converse: Converse = async () => proseJson();
    const result = await generateSimplified({ detail: DETAIL, lang: "en", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.body.questions.map((q) => q.id).sort();
    // age_min + the three supported free-text mappings (T2DM, T1DM, hospice).
    expect(ids).toEqual(["age_min", "hospice", "t1dm_exclusion", "t2dm_diagnosis"]);
    const t2 = result.body.questions.find((q) => q.id === "t2dm_diagnosis")!;
    expect(t2.text).toBe("Do you have type 2 diabetes?");
    expect(t2.kind).toBe("inclusion");
    expect(t2.ruleOutIf).toBe("no");
    const t1 = result.body.questions.find((q) => q.id === "t1dm_exclusion")!;
    expect(t1.kind).toBe("exclusion");
    expect(t1.ruleOutIf).toBe("yes");
    const age = result.body.questions.find((q) => q.id === "age_min")!;
    expect(age.source_criterion).toBe("minimumAge = 18 years");
  });

  it("a model that injects its own questions cannot change the checklist", async () => {
    const converse: Converse = async () =>
      JSON.stringify({
        ...validProse(),
        questions: [{ id: "evil", text: "Do you have asthma?", ruleOutIf: "yes", source_criterion: "x", kind: "exclusion" }],
      });
    const result = await generateSimplified({ detail: DETAIL, lang: "en", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.questions.find((q) => q.id === "evil")).toBeUndefined();
    expect(result.body.questions.some((q) => /asthma/i.test(q.text))).toBe(false);
  });
});

describe("generateSimplified — Spanish uses deterministic localized questions", () => {
  it("translates only prose; questions come from the es mapping wording", async () => {
    const converse: Converse = async (_m, prompt) =>
      prompt.system.includes("translate")
        ? proseJson({ summary: "Estudio en Boston Medical Center sobre diabetes tipo 2. Participar es su elección." })
        : proseJson();
    const result = await generateSimplified({ detail: DETAIL, lang: "es", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t2 = result.body.questions.find((q) => q.id === "t2dm_diagnosis")!;
    expect(t2.text).toBe("¿Tiene diabetes tipo 2?");
    expect(t2.ruleOutIf).toBe("no"); // rule-out logic unchanged across languages
  });
});

describe("generateSimplified — unsupported language fails closed", () => {
  it("returns a safe error for pt/ht/zh/vi", async () => {
    const converse: Converse = async () => proseJson();
    for (const lang of ["pt", "ht", "zh", "vi"] as const) {
      const r = await generateSimplified({ detail: DETAIL, lang, converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
      expect(r.ok).toBe(false);
    }
  });
});

describe("generateSimplified — too few supported questions fails closed", () => {
  it("returns a safe error when the criteria yield < 2 supported questions", async () => {
    const thin: TrialDetail = {
      ...DETAIL,
      eligibility: {
        ...DETAIL.eligibility,
        minAgeYears: null, // no age question
        criteriaText: "Inclusion Criteria:\n* Must speak English.\nExclusion Criteria:\n* None.",
      },
    };
    const converse: Converse = async () => proseJson();
    const r = await generateSimplified({ detail: thin, lang: "en", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(r.ok).toBe(false);
  });
});

describe("generateSimplified — model failures → safe error (never fabricated)", () => {
  it("malformed JSON then success (retry) succeeds", async () => {
    let n = 0;
    const converse: Converse = async () => {
      n += 1;
      if (n === 1) return "not json at all";
      return proseJson();
    };
    const r = await generateSimplified({ detail: DETAIL, lang: "en", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("all attempts malformed → safe error", async () => {
    const converse: Converse = async () => "still not json";
    const r = await generateSimplified({ detail: DETAIL, lang: "en", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(r.ok).toBe(false);
  });

  it("unsafe prose exhausts attempts → safe error", async () => {
    const converse: Converse = async () => proseJson({ whatYouDo: "You qualify for this trial." });
    const r = await generateSimplified({ detail: DETAIL, lang: "en", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(r.ok).toBe(false);
  });
});

describe("generateSimplified — total budget bound (hung + slow models)", () => {
  it("a hung model returns a safe error within budget", async () => {
    const hung: Converse = (_m, _p, signal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const start = Date.now();
    const r = await generateSimplified({ detail: DETAIL, lang: "en", converse: hung, timeoutMs: 40, budgetMs: 120 });
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    expect(elapsed).toBeLessThan(1000);
  });

  it("budget exhaustion skips further calls", async () => {
    const slow: Converse = (_m, _p, signal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const r = await generateSimplified({ detail: DETAIL, lang: "en", converse: slow, timeoutMs: 30, budgetMs: 60 });
    expect(r.ok).toBe(false);
  });
});

describe("generateSimplified — translation retry then safe error", () => {
  // The translation system prompt is uniquely identified by its opening sentence. We do NOT
  // discriminate on the substring "translate": the English PROSE prompt also contains it
  // ("Never translate or reformat them."), so matching on it would also corrupt the English
  // generation and let a self-consistent bad number slip the invariant.
  const isTranslateCall = (prompt: { system: string }): boolean =>
    prompt.system.includes("You translate a small JSON object");
  it("bad translations exhaust attempts → safe 503-worthy error", async () => {
    let enCalls = 0;
    let trCalls = 0;
    const converse: Converse = async (_m, prompt) => {
      if (isTranslateCall(prompt)) {
        trCalls += 1;
        // A translation that INVENTS a number (99) not present in the English prose. Each
        // attempt returns the same bad prose so the bounded retries all fail the invariant.
        return proseJson({ timeCommitment: "Unas visitas durante 99 meses." });
      }
      enCalls += 1;
      return proseJson();
    };
    const r = await generateSimplified({ detail: DETAIL, lang: "es", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    // The invented number is caught by checkProseTranslationInvariants on every attempt, so
    // the request exhausts its bounded attempts and returns a safe error — never the body.
    expect(r.ok).toBe(false);
    // The English generation succeeded (clean prose); only the translation kept failing.
    expect(enCalls).toBe(1);
    // Bounded: primary + retry + fallback = 3 translation attempts, no more.
    expect(trCalls).toBe(3);
  });
  it("a translation that changes the disease type is rejected → safe error", async () => {
    const converse: Converse = async (_m, prompt) => {
      if (prompt.system.includes("You translate a small JSON object")) {
        // "type 1" where the English said "type 2": a disease-type flip. The number 1 is new
        // relative to the English prose, so the numeric-invariant fails closed on every try.
        return proseJson({ summary: "Este estudio en Boston Medical Center analiza la atención de la diabetes tipo 1. Participar es su elección." });
      }
      return proseJson();
    };
    const r = await generateSimplified({ detail: DETAIL, lang: "es", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(r.ok).toBe(false);
  });
  it("a translation that injects an eligibility claim is rejected → safe error", async () => {
    const converse: Converse = async (_m, prompt) => {
      if (prompt.system.includes("You translate a small JSON object")) {
        return proseJson({ whatYouDo: "Usted es elegible para este estudio." });
      }
      return proseJson();
    };
    const r = await generateSimplified({ detail: DETAIL, lang: "es", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(r.ok).toBe(false);
  });
  it("a faithful translation succeeds and keeps the server-built questions", async () => {
    const converse: Converse = async (_m, prompt) => {
      if (prompt.system.includes("You translate a small JSON object")) {
        return proseJson({
          summary: "Este estudio en Boston Medical Center analiza la atención de la diabetes tipo 2. Participar es su elección.",
          whatYouDo: "Usted visita la clínica y responde preguntas sobre su salud.",
          timeCommitment: "Unas 4 visitas durante 6 meses.",
          staff_checks: ["El equipo del estudio revisará sus resultados de laboratorio."],
        });
      }
      return proseJson();
    };
    const r = await generateSimplified({ detail: DETAIL, lang: "es", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Questions are server-built and localized from the mapping's OWN Spanish wording,
      // never from the model's translation.
      const t2 = r.body.questions.find((q) => q.id === "t2dm_diagnosis");
      expect(t2?.text).toBe("¿Tiene diabetes tipo 2?");
      expect(t2?.ruleOutIf).toBe("no");
      expect(t2?.kind).toBe("inclusion");
    }
  });
});
