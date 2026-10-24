// Unit tests for the PURE helpers in lib/bedrock.ts (spec: simplify).
// No network, no SDK calls — the transport is never exercised here.
import { describe, expect, it } from "vitest";
import type { TrialDetail } from "./types";
import {
  buildEnglishPrompt,
  buildTranslatePrompt,
  extractProtectedValues,
  parseLang,
  parseNct,
  toResponseBody,
  validateModelOutput,
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
