// Tests for POST /api/simplify (spec: simplify) under the DEFAULT-DENY redesign.
//
// The route is the I/O layer, so two things are mocked: the upstream `fetch`
// (ClinicalTrials.gov) and the Bedrock SDK's ConverseCommand transport. NO live Bedrock
// call is ever made. The Bedrock mock is a queue of responses so each test controls exactly
// what the model "returns" and we can assert retry/fallback/timeout behavior.
//
// The model now authors ONLY prose; the SERVER builds the checklist from the real registry
// criteria. So the mock study body carries the REAL NCT07043426 criteria and the mock model
// returns prose only. A model that injects its own questions can never surface them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// --- Bedrock SDK mock -------------------------------------------------------
type SendBehavior = string | Error | (() => Promise<string>);
const bedrock = {
  queue: [] as SendBehavior[],
  modelIds: [] as string[],
};
vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  class ConverseCommand {
    constructor(public input: { modelId: string }) {}
  }
  class BedrockRuntimeClient {
    async send(command: ConverseCommand): Promise<unknown> {
      bedrock.modelIds.push(command.input.modelId);
      const next = bedrock.queue.shift();
      if (next === undefined) throw new Error("no mock Bedrock response queued");
      if (next instanceof Error) throw next;
      const text = typeof next === "function" ? await next() : next;
      return { output: { message: { content: [{ text }] } } };
    }
  }
  return { BedrockRuntimeClient, ConverseCommand };
});
import { clearSimplifyCache } from "../../../lib/bedrock";
import { POST } from "./route";
// --- helpers ----------------------------------------------------------------
const NCT = "NCT07043426";
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

function studyBody(nct = NCT) {
  return {
    studies: [
      {
        protocolSection: {
          identificationModule: { nctId: nct, briefTitle: "THRIVE-DM at BMC" },
          conditionsModule: { conditions: ["Type 2 Diabetes"] },
          designModule: { phases: ["PHASE2"] },
          descriptionModule: { briefSummary: "A diabetes study. Call 617-555-0100 or email team@bmc.org." },
          eligibilityModule: {
            eligibilityCriteria: HERO_CRITERIA,
            sex: "ALL",
            minimumAge: "18 Years",
            healthyVolunteers: false,
          },
          contactsLocationsModule: {
            locations: [
              { facility: "Boston Medical Center", city: "Boston", state: "Massachusetts", zip: "02118", status: "RECRUITING", geoPoint: { lat: 42.335, lon: -71.0728 } },
            ],
            centralContacts: [{ name: "Study Team", phone: "617-555-0100", email: "team@bmc.org", role: "CONTACT" }],
          },
        },
      },
    ],
    totalCount: 1,
  };
}
/** PROSE-only model output (no questions — the server builds those). */
function goodProse(extra: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    summary:
      "This study at Boston Medical Center looks at type 2 diabetes. You may be put by chance in a group that gets usual care. Taking part is your choice.",
    whatYouDo: "You visit the clinic and answer questions. Call 617-555-0100 or email team@bmc.org.",
    timeCommitment: "About 4 visits over 6 months.",
    staff_checks: ["The study team will check your labs."],
    ...extra,
  });
}
/** A faithful Spanish prose translation — only text changes, no new numbers. */
function goodProseEs() {
  return JSON.stringify({
    summary:
      "Este estudio en Boston Medical Center analiza la diabetes tipo 2. Puede quedar por azar en un grupo que recibe la atención habitual. Participar es su elección.",
    whatYouDo: "Usted visita la clínica y responde preguntas. Llame al 617-555-0100 o escriba a team@bmc.org.",
    timeCommitment: "Unas 4 visitas durante 6 meses.",
    staff_checks: ["El equipo del estudio revisará sus análisis."],
  });
}
function mockFetchStudy(nct = NCT) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(studyBody(nct)), { status: 200, headers: { "content-type": "application/json" } })),
  );
}
function req(body: unknown, { raw = false }: { raw?: boolean } = {}): Request {
  return new Request("http://localhost/api/simplify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
beforeEach(() => {
  bedrock.queue = [];
  bedrock.modelIds = [];
  clearSimplifyCache();
  process.env.BEDROCK_MODEL_ID = "primary-model";
  process.env.BEDROCK_FALLBACK_MODEL_ID = "fallback-model";
  process.env.AWS_REGION = "us-east-2";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
// ---------------------------------------------------------------------------
describe("validation", () => {
  it("400 on non-JSON body", async () => {
    const res = await POST(req("{not json", { raw: true }));
    expect(res.status).toBe(400);
  });
  it("400 on a bad NCT id", async () => {
    const res = await POST(req({ nct: "NCT1", lang: "en" }));
    expect(res.status).toBe(400);
  });
  it("400 on an unsupported language", async () => {
    const res = await POST(req({ nct: NCT, lang: "fr" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("lang") });
  });
  it("does not call fetch or Bedrock when validation fails", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await POST(req({ nct: "bad", lang: "en" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(bedrock.modelIds).toHaveLength(0);
  });
});
describe("success", () => {
  it("200 with frontend-contract fields, SERVER-built questions, and preserved identifiers", async () => {
    const nct = "NCT10000001";
    mockFetchStudy(nct);
    bedrock.queue = [goodProse()];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.whatItStudies).toBeTruthy();
    expect(body.whatYouDo).toBeTruthy();
    expect(body.lang).toBe("en");
    expect(Array.isArray(body.questions)).toBe(true);
    // Server-built: age_min + T2DM + T1DM + hospice.
    const ids = body.questions.map((q: { id: string }) => q.id).sort();
    expect(ids).toEqual(["age_min", "hospice", "t1dm_exclusion", "t2dm_diagnosis"]);
    for (const q of body.questions) expect(["yes", "no"]).toContain(q.ruleOutIf);
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("617-555-0100");
    expect(serialized).toContain("team@bmc.org");
    expect(bedrock.modelIds).toEqual(["primary-model"]);
  });
  it("a model that injects its own questions cannot change the server checklist", async () => {
    const nct = "NCT10000008";
    mockFetchStudy(nct);
    bedrock.queue = [
      goodProse({ questions: [{ id: "evil", text: "Do you have asthma?", ruleOutIf: "yes", source_criterion: "x", kind: "exclusion" }] }),
    ];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions.some((q: { id: string }) => q.id === "evil")).toBe(false);
    expect(body.questions.some((q: { text: string }) => /asthma/i.test(q.text))).toBe(false);
  });
  it("404 when the upstream has no study", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ studies: [] }), { status: 200 })));
    const res = await POST(req({ nct: "NCT10000002", lang: "en" }));
    expect(res.status).toBe(404);
  });
});
describe("retry + fallback bounds", () => {
  it("retries once on malformed prose, then succeeds on the second primary attempt", async () => {
    const nct = "NCT10000003";
    mockFetchStudy(nct);
    bedrock.queue = ["not json at all", goodProse()];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(200);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model"]);
  });
  it("schema-invalid JSON (valid JSON, missing required prose) retries then succeeds", async () => {
    const nct = "NCT10000013";
    mockFetchStudy(nct);
    // Valid JSON object but missing whatYouDo/timeCommitment -> fails shape validation.
    const schemaInvalid = JSON.stringify({ summary: "A study." });
    bedrock.queue = [schemaInvalid, goodProse()];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(200);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model"]);
  });
  it("schema-invalid JSON on every attempt → 503 (never a partial body)", async () => {
    const nct = "NCT10000014";
    mockFetchStudy(nct);
    const schemaInvalid = JSON.stringify({ summary: "A study." });
    bedrock.queue = [schemaInvalid, schemaInvalid, schemaInvalid];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(503);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model", "fallback-model"]);
    const body = await res.json();
    expect(body.summary).toBeUndefined();
    expect(body.questions).toBeUndefined();
  });
  it("a model that injects questions/kind/ruleOutIf alongside VALID prose still yields only server questions", async () => {
    const nct = "NCT10000015";
    mockFetchStudy(nct);
    bedrock.queue = [
      goodProse({
        questions: [
          { id: "age", text: "Are you at least 18 years old?", ruleOutIf: "yes", kind: "exclusion", source_criterion: "minimumAge = 18 years" },
          { id: "t2", text: "Do you NOT have type 2 diabetes?", ruleOutIf: "no", kind: "inclusion", source_criterion: "x" },
        ],
      }),
    ];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.questions.map((q: { id: string }) => q.id).sort();
    expect(ids).toEqual(["age_min", "hospice", "t1dm_exclusion", "t2dm_diagnosis"]);
    // The injected wrong-polarity age and negated T2 never surface.
    const age = body.questions.find((q: { id: string }) => q.id === "age_min");
    expect(age.kind).toBe("inclusion");
    expect(age.ruleOutIf).toBe("no");
    expect(body.questions.some((q: { text: string }) => /\bnot\b/i.test(q.text))).toBe(false);
  });
  it("falls back to the fallback model exactly once, then 503 when all attempts are bad", async () => {
    const nct = "NCT10000004";
    mockFetchStudy(nct);
    bedrock.queue = ["bad1", "bad2", "bad3"];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(503);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model", "fallback-model"]);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.summary).toBeUndefined();
    expect(body.whatItStudies).toBeUndefined();
  });
  it("unsafe prose (forbidden phrase) exhausts attempts → 503", async () => {
    const nct = "NCT10000009";
    mockFetchStudy(nct);
    const unsafe = goodProse({ whatYouDo: "You qualify for this trial." });
    bedrock.queue = [unsafe, unsafe, unsafe];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(503);
  });
});
describe("timeout", () => {
  it("503 when every Bedrock call aborts/times out", async () => {
    const nct = "NCT10000005";
    mockFetchStudy(nct);
    const aborter: SendBehavior = () =>
      new Promise<string>((_resolve, reject) => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    bedrock.queue = [aborter, aborter, aborter];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(503);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model", "fallback-model"]);
  });
});
describe("caching", () => {
  it("separates cache by language and does not re-invoke Bedrock on a repeat call", async () => {
    const nct = "NCT10000006";
    mockFetchStudy(nct);
    bedrock.queue = [goodProse()];
    const en1 = await POST(req({ nct, lang: "en" }));
    expect(en1.status).toBe(200);
    const enCalls = bedrock.modelIds.length;
    const en2 = await POST(req({ nct, lang: "en" }));
    expect(en2.status).toBe(200);
    expect(bedrock.modelIds.length).toBe(enCalls);
    // Spanish: English prose + Spanish prose translation.
    bedrock.queue = [goodProse(), goodProseEs()];
    const es = await POST(req({ nct, lang: "es" }));
    expect(es.status).toBe(200);
    expect((await es.json()).lang).toBe("es");
    expect(bedrock.modelIds.length).toBeGreaterThan(enCalls);
  });
  it("does not cache a failure", async () => {
    const nct = "NCT10000007";
    mockFetchStudy(nct);
    bedrock.queue = ["bad", "bad", "bad"];
    const fail = await POST(req({ nct, lang: "en" }));
    expect(fail.status).toBe(503);
    bedrock.queue = [goodProse()];
    const ok = await POST(req({ nct, lang: "en" }));
    expect(ok.status).toBe(200);
  });
});
// ---------------------------------------------------------------------------
// Spanish: questions use the deterministic es wording; only prose is translated.
// ---------------------------------------------------------------------------
describe("spanish localized checklist", () => {
  it("200 with es question wording and unchanged rule-out logic", async () => {
    const nct = "NCT20000003";
    mockFetchStudy(nct);
    bedrock.queue = [goodProse(), goodProseEs()];
    const res = await POST(req({ nct, lang: "es" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lang).toBe("es");
    const t2 = body.questions.find((q: { id: string }) => q.id === "t2dm_diagnosis");
    expect(t2.text).toBe("¿Tiene diabetes tipo 2?");
    expect(t2.ruleOutIf).toBe("no");
  });
  it("503 when the prose translation introduces a new number (invariant), after retries", async () => {
    const nct = "NCT20000001";
    mockFetchStudy(nct);
    const badEs = JSON.stringify({
      summary: "Estudio en Boston Medical Center sobre diabetes tipo 2. Participar es su elección.",
      whatYouDo: "Usted visita la clínica.",
      timeCommitment: "Unas 4 visitas durante 99 meses.", // 99 not in English prose
      staff_checks: [],
    });
    bedrock.queue = [goodProse(), badEs, badEs, badEs];
    const res = await POST(req({ nct, lang: "es" }));
    expect(res.status).toBe(503);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model", "primary-model", "fallback-model"]);
    const body = await res.json();
    expect(body.summary).toBeUndefined();
  });
});
// ---------------------------------------------------------------------------
// Unsupported languages for the checklist fail closed with a safe error.
// ---------------------------------------------------------------------------
describe("unsupported checklist languages fail closed", () => {
  it("503 for pt/ht/zh/vi (valid lang param, but no deterministic question wording)", async () => {
    for (const lang of ["pt", "ht", "zh", "vi"]) {
      const nct = `NCT3000000${["pt", "ht", "zh", "vi"].indexOf(lang)}`;
      mockFetchStudy(nct);
      bedrock.queue = [goodProse(), goodProse(), goodProse()];
      const res = await POST(req({ nct, lang }));
      expect(res.status).toBe(503);
    }
  });
});
