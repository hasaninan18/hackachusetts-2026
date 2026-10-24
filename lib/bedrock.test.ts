// Unit tests for the PURE helpers in lib/bedrock.ts (spec: simplify).
// No network, no SDK calls — the transport is never exercised here.
import { describe, expect, it } from "vitest";
import type { TrialDetail } from "./types";
import {
  BEDROCK_TOTAL_BUDGET_MS,
  CLIENT_TIMEOUT_FLOOR_MS,
  PER_CALL_TIMEOUT_MS,
  SERVER_TOTAL_BUDGET_MS,
  STUDY_LOAD_BUDGET_MS,
  buildEnglishPrompt,
  buildTranslatePrompt,
  checkSourceCriteria,
  checkTranslationInvariants,
  extractProtectedValues,
  generateSimplified,
  isStructuredAgeCriterion,
  parseLang,
  parseNct,
  toResponseBody,
  validateModelOutput,
  type Converse,
  type SimplifyModel,
} from "./bedrock";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
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
    criteriaText: "Inclusion: Age 18 or older. Type 2 diabetes. A1c 9 or higher. BMC primary-care patient. Exclusion: hospice care.",
  },
  sites: [{ name: "Boston Medical Center", city: "Boston", lat: 42.335, lon: -71.0728, locationPrecision: "facility" }],
  contacts: [{ name: "Study Team", phone: "617-555-0100", email: "team@bmc.org" }],
  stops: [],
};

function validModel(overrides: Partial<SimplifyModel> = {}): SimplifyModel {
  return {
    summary:
      "This study at Boston Medical Center looks at type 2 diabetes care. You may be put by chance in a group that gets usual care. Taking part is your choice.",
    whatYouDo: "You visit the clinic and answer questions about your health.",
    timeCommitment: "About 4 visits over 6 months.",
    questions: [
      { id: "q1", text: "Are you 18 years or older?", ruleOutIf: "no", source_criterion: "Age 18 or older", kind: "inclusion" },
      { id: "q2", text: "Do you have type 2 diabetes?", ruleOutIf: "no", source_criterion: "Type 2 diabetes", kind: "inclusion" },
      { id: "q3", text: "Are you in hospice care?", ruleOutIf: "yes", source_criterion: "hospice care", kind: "exclusion" },
    ],
    staff_checks: ["The study team will check your lab results."],
    ...overrides,
  };
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
  it("pulls NCTs, emails, phones and keeps phone/email apart", () => {
    const p = extractProtectedValues("Call 617-555-0100 or 8005551234 email a@b.org about NCT01234567");
    expect(p.ncts).toEqual(["NCT01234567"]);
    expect(p.emails).toEqual(["a@b.org"]);
    expect(p.phones).toContain("617-555-0100");
    // the email's digits must not be read as a phone
    expect(p.phones.some((x) => x.includes("@"))).toBe(false);
  });
});

describe("validateModelOutput — shape", () => {
  it("accepts a valid model", () => {
    const r = validateModelOutput(JSON.stringify(validModel()), { lang: "en", source: SOURCE });
    expect(r.ok).toBe(true);
  });
  it("strips code fences before parsing", () => {
    const fenced = "```json\n" + JSON.stringify(validModel()) + "\n```";
    expect(validateModelOutput(fenced, { lang: "en", source: SOURCE }).ok).toBe(true);
  });
  it("rejects non-JSON", () => {
    expect(validateModelOutput("not json", { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects fewer than 3 questions", () => {
    const r = validateModelOutput(
      JSON.stringify(validModel({ questions: validModel().questions.slice(0, 2) })),
      { lang: "en", source: SOURCE },
    );
    expect(r.ok).toBe(false);
  });
  it("rejects more than 6 questions", () => {
    const q = validModel().questions;
    const seven = [...q, ...q, ...q].slice(0, 7).map((x, i) => ({ ...x, id: `q${i}` }));
    expect(validateModelOutput(JSON.stringify(validModel({ questions: seven })), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects duplicate ids", () => {
    const dup = validModel().questions.map((x) => ({ ...x, id: "same" }));
    expect(validateModelOutput(JSON.stringify(validModel({ questions: dup })), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects a bad ruleOutIf enum", () => {
    const bad = validModel();
    (bad.questions[0] as unknown as { ruleOutIf: string }).ruleOutIf = "maybe";
    expect(validateModelOutput(JSON.stringify(bad), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects a missing source_criterion", () => {
    const bad = validModel();
    (bad.questions[0] as unknown as { source_criterion?: string }).source_criterion = "";
    expect(validateModelOutput(JSON.stringify(bad), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects an over-80-word summary", () => {
    const long = Array.from({ length: 90 }, () => "word").join(" ");
    expect(validateModelOutput(JSON.stringify(validModel({ summary: long })), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
});

describe("validateModelOutput — safety", () => {
  it("rejects an English forbidden phrase", () => {
    const bad = validModel({ summary: "Good news, you are eligible for this study. Taking part is your choice." });
    expect(validateModelOutput(JSON.stringify(bad), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects a Spanish forbidden phrase", () => {
    const bad = validModel({ whatYouDo: "Usted califica para participar." });
    expect(validateModelOutput(JSON.stringify(bad), { lang: "es", source: SOURCE }).ok).toBe(false);
  });
  it("still catches leaked English in a non-English response", () => {
    const bad = validModel({ whatYouDo: "You qualify." });
    expect(validateModelOutput(JSON.stringify(bad), { lang: "es", source: SOURCE }).ok).toBe(false);
  });
  it("rejects an introduced NCT id not in the source", () => {
    const bad = validModel({ whatYouDo: "See trial NCT99999999 for details." });
    expect(validateModelOutput(JSON.stringify(bad), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects an introduced email not in the source", () => {
    const bad = validModel({ whatYouDo: "Email evil@attacker.com to join." });
    expect(validateModelOutput(JSON.stringify(bad), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("rejects an altered phone number", () => {
    const bad = validModel({ whatYouDo: "Call 617-555-9999 now." });
    expect(validateModelOutput(JSON.stringify(bad), { lang: "en", source: SOURCE }).ok).toBe(false);
  });
  it("accepts a source phone echoed verbatim", () => {
    const ok = validModel({ whatYouDo: "Call the study team at 617-555-0100." });
    expect(validateModelOutput(JSON.stringify(ok), { lang: "en", source: SOURCE }).ok).toBe(true);
  });
});

describe("prompt builders", () => {
  it("English prompt embeds criteria inside a delimited untrusted data block", () => {
    const { system, user } = buildEnglishPrompt(DETAIL);
    expect(user).toContain("<STUDY_DATA>");
    expect(user).toContain("</STUDY_DATA>");
    expect(user).toContain("Age 18 or older");
    expect(system).toContain("untrusted DATA");
    expect(system).toMatch(/JSON only/i);
    // structured age bounds (rule 6)
    expect(user).toContain("minimum age = 18 years");
    expect(user).toContain("maximum age = none");
  });
  it("translate prompt carries the English JSON and the usted instruction for Spanish", () => {
    const english = JSON.stringify(validModel());
    const { system, user } = buildTranslatePrompt(english, "es");
    expect(user).toContain(english);
    expect(system).toMatch(/usted/i);
    expect(system).toContain("same JSON structure".replace("JSON ", "JSON ")); // structure preserved
  });
});

describe("toResponseBody", () => {
  it("mirrors summary into whatItStudies and sets lang", () => {
    const body = toResponseBody(validModel(), "es");
    expect(body.whatItStudies).toBe(body.summary);
    expect(body.lang).toBe("es");
  });
});

// ---------------------------------------------------------------------------
// Translation invariants (Task 2) — the English JSON is the structural source of truth.
// ---------------------------------------------------------------------------
describe("checkTranslationInvariants", () => {
  const english = validModel();
  /** A faithful translation: only human-readable text changes, structure is identical. */
  function faithful(): SimplifyModel {
    return validModel({
      summary: "Este estudio en Boston Medical Center analiza la diabetes tipo 2. Participar es su decisión.",
      questions: english.questions.map((q) => ({ ...q, text: `(es) ${q.text}` })),
    });
  }

  it("accepts a translation that only changes human-readable text", () => {
    expect(checkTranslationInvariants(english, faithful())).toBeNull();
  });

  it("rejects a translation that drops a question", () => {
    const dropped = faithful();
    dropped.questions = dropped.questions.slice(0, english.questions.length - 1);
    expect(checkTranslationInvariants(english, dropped)).toMatch(/number of questions/);
  });

  it("rejects a translation that adds a question", () => {
    const added = faithful();
    added.questions = [...added.questions, { id: "q9", text: "extra", ruleOutIf: "no", source_criterion: "x", kind: "inclusion" }];
    expect(checkTranslationInvariants(english, added)).toMatch(/number of questions/);
  });

  it("rejects a translation that reorders questions", () => {
    const reordered = faithful();
    reordered.questions = [reordered.questions[1], reordered.questions[0], reordered.questions[2]];
    expect(checkTranslationInvariants(english, reordered)).toMatch(/reordered or renamed/);
  });

  it("rejects a translation that renames a question id", () => {
    const renamed = faithful();
    renamed.questions[0] = { ...renamed.questions[0], id: "zzz" };
    expect(checkTranslationInvariants(english, renamed)).toMatch(/reordered or renamed/);
  });

  it("rejects a translation that alters ruleOutIf", () => {
    const altered = faithful();
    altered.questions[0] = { ...altered.questions[0], ruleOutIf: altered.questions[0].ruleOutIf === "yes" ? "no" : "yes" };
    expect(checkTranslationInvariants(english, altered)).toMatch(/altered ruleOutIf/);
  });

  it("rejects a translation that alters kind", () => {
    const altered = faithful();
    altered.questions[0] = { ...altered.questions[0], kind: altered.questions[0].kind === "inclusion" ? "exclusion" : "inclusion" };
    expect(checkTranslationInvariants(english, altered)).toMatch(/altered kind/);
  });

  it("rejects a translation that TRANSLATES source_criterion (must stay original English)", () => {
    const translatedQuote = faithful();
    translatedQuote.questions[0] = { ...translatedQuote.questions[0], source_criterion: "Edad 18 o más" };
    expect(checkTranslationInvariants(english, translatedQuote)).toMatch(/source_criterion/);
  });
});

// ---------------------------------------------------------------------------
// source_criterion grounding + structured age bounds (Task 3).
// ---------------------------------------------------------------------------
describe("isStructuredAgeCriterion", () => {
  it("recognizes references to the structured age fields", () => {
    expect(isStructuredAgeCriterion("minimumAge")).toBe(true);
    expect(isStructuredAgeCriterion("structured age bounds")).toBe(true);
    expect(isStructuredAgeCriterion("maximum age = 65 years")).toBe(true);
  });
  it("does not flag a normal free-text quote", () => {
    expect(isStructuredAgeCriterion("Type 2 diabetes")).toBe(false);
  });
});

describe("checkSourceCriteria", () => {
  it("accepts source_criterion quotes substantively present in the criteria text", () => {
    expect(checkSourceCriteria(validModel(), DETAIL)).toBeNull();
  });

  it("allows whitespace/case normalization when matching a quote", () => {
    const model = validModel({
      questions: [
        { id: "q1", text: "diabetes?", ruleOutIf: "no", source_criterion: "type   2   DIABETES", kind: "inclusion" },
        { id: "q2", text: "hospice?", ruleOutIf: "yes", source_criterion: "Hospice Care", kind: "exclusion" },
        { id: "q3", text: "a1c?", ruleOutIf: "no", source_criterion: "A1c 9 or higher", kind: "inclusion" },
      ],
    });
    expect(checkSourceCriteria(model, DETAIL)).toBeNull();
  });

  it("rejects a fabricated quote not present in the criteria", () => {
    const model = validModel({
      questions: [
        { id: "q1", text: "x?", ruleOutIf: "no", source_criterion: "Must own a red car", kind: "inclusion" },
        { id: "q2", text: "y?", ruleOutIf: "no", source_criterion: "Type 2 diabetes", kind: "inclusion" },
        { id: "q3", text: "z?", ruleOutIf: "yes", source_criterion: "hospice care", kind: "exclusion" },
      ],
    });
    expect(checkSourceCriteria(model, DETAIL)).toMatch(/not present in the eligibility criteria/);
  });

  it("rejects a materially altered quote", () => {
    const model = validModel({
      questions: [
        { id: "q1", text: "x?", ruleOutIf: "no", source_criterion: "A1c 2 or lower", kind: "inclusion" },
        { id: "q2", text: "y?", ruleOutIf: "no", source_criterion: "Type 2 diabetes", kind: "inclusion" },
        { id: "q3", text: "z?", ruleOutIf: "yes", source_criterion: "hospice care", kind: "exclusion" },
      ],
    });
    expect(checkSourceCriteria(model, DETAIL)).toMatch(/not present/);
  });

  it("ACCEPTS an age question sourced from STRUCTURED age bounds with no verbatim free-text match", () => {
    // A study whose criteria text does NOT contain an age phrase, but DOES have a structured minAgeYears.
    const structuredOnly: TrialDetail = {
      ...DETAIL,
      eligibility: {
        ...DETAIL.eligibility,
        minAgeYears: 18,
        maxAgeYears: null,
        criteriaText: "Inclusion: Type 2 diabetes. Exclusion: hospice care.",
      },
    };
    const model = validModel({
      questions: [
        { id: "q1", text: "Are you 18 or older?", ruleOutIf: "no", source_criterion: "minimumAge = 18 years", kind: "inclusion" },
        { id: "q2", text: "diabetes?", ruleOutIf: "no", source_criterion: "Type 2 diabetes", kind: "inclusion" },
        { id: "q3", text: "hospice?", ruleOutIf: "yes", source_criterion: "hospice care", kind: "exclusion" },
      ],
    });
    expect(checkSourceCriteria(model, structuredOnly)).toBeNull();
  });

  it("rejects a structured-age citation when the study has NO age bounds", () => {
    const noAge: TrialDetail = {
      ...DETAIL,
      eligibility: { ...DETAIL.eligibility, minAgeYears: null, maxAgeYears: null },
    };
    const model = validModel({
      questions: [
        { id: "q1", text: "age?", ruleOutIf: "no", source_criterion: "minimumAge = 18 years", kind: "inclusion" },
        { id: "q2", text: "diabetes?", ruleOutIf: "no", source_criterion: "Type 2 diabetes", kind: "inclusion" },
        { id: "q3", text: "hospice?", ruleOutIf: "yes", source_criterion: "hospice care", kind: "exclusion" },
      ],
    });
    expect(checkSourceCriteria(model, noAge)).toMatch(/structured age bounds but the study has none/);
  });
});

// ---------------------------------------------------------------------------
// Orchestration bounds (Task 1 budget + Task 2/3 retry/fallback). converse is INJECTED,
// so these exercise the real deadline/retry/fallback logic with NO network and NO SDK.
// ---------------------------------------------------------------------------

describe("budget math constants", () => {
  it("server total budget is the sum of study-load + bedrock budgets", () => {
    expect(SERVER_TOTAL_BUDGET_MS).toBe(STUDY_LOAD_BUDGET_MS + BEDROCK_TOTAL_BUDGET_MS);
  });
  it("client timeout floor is >= the server total budget (so the client never gives up first)", () => {
    expect(CLIENT_TIMEOUT_FLOOR_MS).toBeGreaterThanOrEqual(SERVER_TOTAL_BUDGET_MS);
  });
  it("per-call timeout is bounded and leaves room for retry+fallback within the budget", () => {
    expect(PER_CALL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PER_CALL_TIMEOUT_MS).toBeLessThanOrEqual(BEDROCK_TOTAL_BUDGET_MS);
  });
});

describe("generateSimplified — total budget bound", () => {
  it("returns a safe error WITHIN the budget when Bedrock hangs (never resolves until aborted)", async () => {
    // converse that hangs until the AbortController fires, then rejects — models a hung model.
    const hung: Converse = (_m, _p, signal) =>
      new Promise<string>((_resolve, reject) => {
        if (signal.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const start = Date.now();
    const result = await generateSimplified({
      detail: DETAIL,
      lang: "en",
      converse: hung,
      // Tiny budget + tiny per-call so the whole thing resolves in a few ms, proving the
      // bound is wall-clock enforced (no hang) without waiting the production 7s.
      budgetMs: 120,
      timeoutMs: 40,
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/english generation failed|budget/);
    // Must finish well within the tiny budget's order of magnitude (generous CI margin).
    expect(elapsed).toBeLessThan(2000);
  });

  it("stops starting new Bedrock calls once the shared deadline is exhausted", async () => {
    let calls = 0;
    const slow: Converse = (_m, _p, signal) =>
      new Promise<string>((_resolve, reject) => {
        calls += 1;
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const result = await generateSimplified({
      detail: DETAIL,
      lang: "en",
      converse: slow,
      budgetMs: 60,
      timeoutMs: 50,
    });
    expect(result.ok).toBe(false);
    // Bounded: at most the 3 English attempts (primary, retry, fallback) are ever started.
    expect(calls).toBeLessThanOrEqual(3);
  });
});

describe("generateSimplified — translation invariants trigger retry/fallback then safe error", () => {
  const goodEnglish = JSON.stringify(validModel());
  // The English model, serialized the way validateModelOutput would reproduce it.
  function englishJsonOut(): string {
    return goodEnglish;
  }

  it("rejects a translation that reorders questions and exhausts into a 503-style error", async () => {
    const reorderedTranslation = JSON.stringify(
      validModel({
        questions: [validModel().questions[1], validModel().questions[0], validModel().questions[2]].map((q) => ({
          ...q,
          text: `(es) ${q.text}`,
        })),
      }),
    );
    let call = 0;
    const converse: Converse = async () => {
      call += 1;
      // First call = English generation (good). All later calls = translation (reordered, invalid).
      return call === 1 ? englishJsonOut() : reorderedTranslation;
    };
    const result = await generateSimplified({ detail: DETAIL, lang: "es", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/translation failed/);
    // 1 English call + 3 translation attempts (primary, retry, fallback) = 4 total.
    expect(call).toBe(4);
  });

  it("rejects a translation that renames an id, and a faithful one on retry succeeds", async () => {
    const renamed = JSON.stringify(
      validModel({ questions: validModel().questions.map((q, i) => (i === 0 ? { ...q, id: "zzz" } : q)) }),
    );
    const faithful = JSON.stringify(
      validModel({ questions: validModel().questions.map((q) => ({ ...q, text: `(es) ${q.text}` })) }),
    );
    let call = 0;
    const converse: Converse = async () => {
      call += 1;
      if (call === 1) return englishJsonOut(); // English
      if (call === 2) return renamed; // translation attempt 1 — rejected
      return faithful; // translation retry — accepted
    };
    const result = await generateSimplified({ detail: DETAIL, lang: "es", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.lang).toBe("es");
      // source_criterion was NOT translated — it stays the original English evidence.
      expect(result.body.questions[0].source_criterion).toBe(validModel().questions[0].source_criterion);
    }
    expect(call).toBe(3);
  });

  it("keeps source_criterion as the ORIGINAL English quote through a successful translation", async () => {
    const faithful = JSON.stringify(
      validModel({ questions: validModel().questions.map((q) => ({ ...q, text: `(es) ${q.text}` })) }),
    );
    let call = 0;
    const converse: Converse = async () => {
      call += 1;
      return call === 1 ? englishJsonOut() : faithful;
    };
    const result = await generateSimplified({ detail: DETAIL, lang: "es", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const q of result.body.questions) {
        const en = validModel().questions.find((e) => e.id === q.id);
        expect(q.source_criterion).toBe(en?.source_criterion);
      }
    }
  });
});
