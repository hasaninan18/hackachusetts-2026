// Tests for POST /api/simplify (spec: simplify) with the summary SEPARATED from the checklist.
//
// The route is the I/O layer, so two things are mocked: the upstream `fetch`
// (ClinicalTrials.gov) and the Bedrock SDK's ConverseCommand transport. NO live Bedrock
// call is ever made. The Bedrock mock is a queue of responses so each test controls exactly
// what the model "returns". The shared cache runs on its in-memory Map (no VERCEL env in
// tests) and is cleared before every test.
//
// The model authors ONLY prose (and, for other languages, the translated title); the SERVER
// builds the checklist from the real registry criteria. Free-text questions are PINNED to
// NCT07043426 and gated by the criteria-revision hash. Any other study still gets a
// translated title + summary, with `questions: []` and a `checklistReason`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HERO_CRITERIA } from "../../../lib/test-fixtures/nct07043426";
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
import { sharedCache } from "../../../lib/shared-cache";
import { POST } from "./route";
// --- helpers ----------------------------------------------------------------
// The PINNED hero study: free-text questions build only for this id with the reviewed hash.
const NCT = "NCT07043426";
const HERO_TITLE = "THRIVE-DM at BMC";

function studyBody(nct = NCT, title = HERO_TITLE) {
  return {
    studies: [
      {
        protocolSection: {
          identificationModule: { nctId: nct, briefTitle: title },
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
/** A faithful Spanish title + prose translation — only text changes, no new numbers. */
function goodProseEs(extra: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    title: "THRIVE-DM en BMC",
    summary:
      "Este estudio en Boston Medical Center analiza la diabetes tipo 2. Puede quedar por azar en un grupo que recibe la atención habitual. Participar es su elección.",
    whatYouDo: "Usted visita la clínica y responde preguntas. Llame al 617-555-0100 o escriba a team@bmc.org.",
    timeCommitment: "Unas 4 visitas durante 6 meses.",
    staff_checks: ["El equipo del estudio revisará sus análisis."],
    ...extra,
  });
}
/** Faithful translations for the languages without reviewed checklist wording. */
const OTHER_LANG_PROSE: Record<"pt" | "ht" | "zh" | "vi", Record<string, unknown>> = {
  pt: {
    title: "THRIVE-DM no BMC",
    summary: "Este estudo no Boston Medical Center analisa o diabetes tipo 2. Participar é sua escolha.",
    whatYouDo: "Você visita a clínica. Ligue para 617-555-0100 ou escreva para team@bmc.org.",
    timeCommitment: "Cerca de 4 visitas em 6 meses.",
    staff_checks: [],
  },
  ht: {
    title: "THRIVE-DM nan BMC",
    summary: "Etid sa a nan Boston Medical Center gade dyabèt tip 2. Patisipe se chwa ou.",
    whatYouDo: "Ou vizite klinik la. Rele 617-555-0100 oswa ekri team@bmc.org.",
    timeCommitment: "Anviwon 4 vizit pandan 6 mwa.",
    staff_checks: [],
  },
  zh: {
    title: "BMC 的 THRIVE-DM 研究",
    summary: "这项在 Boston Medical Center 的研究关注 2 型糖尿病。是否参加由您决定。",
    whatYouDo: "您去诊所回答问题。请拨打 617-555-0100 或发邮件到 team@bmc.org。",
    timeCommitment: "大约 6 个月内 4 次就诊。",
    staff_checks: [],
  },
  vi: {
    title: "THRIVE-DM tại BMC",
    summary: "Nghiên cứu này tại Boston Medical Center tìm hiểu bệnh tiểu đường loại 2. Tham gia là lựa chọn của bạn.",
    whatYouDo: "Bạn đến phòng khám. Gọi 617-555-0100 hoặc gửi email đến team@bmc.org.",
    timeCommitment: "Khoảng 4 lần khám trong 6 tháng.",
    staff_checks: [],
  },
};
function mockFetchStudy(nct = NCT, title = HERO_TITLE) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(studyBody(nct, title)), { status: 200, headers: { "content-type": "application/json" } })),
  );
}
function req(body: unknown, { raw = false }: { raw?: boolean } = {}): Request {
  return new Request("http://localhost/api/simplify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const HERO_IDS = ["age_min", "hospice", "t1dm_exclusion", "t2dm_diagnosis"];
beforeEach(() => {
  bedrock.queue = [];
  bedrock.modelIds = [];
  sharedCache.clearMemory();
  process.env.BEDROCK_MODEL_ID = "primary-model";
  process.env.BEDROCK_FALLBACK_MODEL_ID = "fallback-model";
  process.env.AWS_REGION = "us-east-2";
  vi.spyOn(console, "warn").mockImplementation(() => {});
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
describe("hero study keeps its exact checklist", () => {
  it("en: 200 with the registry title, SERVER-built 4 questions, and preserved identifiers", async () => {
    mockFetchStudy(NCT);
    bedrock.queue = [goodProse()];
    const res = await POST(req({ nct: NCT, lang: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe(HERO_TITLE);
    expect(body.whatItStudies).toBeTruthy();
    expect(body.whatYouDo).toBeTruthy();
    expect(body.lang).toBe("en");
    expect(body.checklistReason).toBeUndefined();
    // Server-built: age_min + T2DM + T1DM + hospice (the pinned study with the reviewed hash).
    expect(body.questions.map((q: { id: string }) => q.id).sort()).toEqual(HERO_IDS);
    for (const q of body.questions) expect(["yes", "no"]).toContain(q.ruleOutIf);
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("617-555-0100");
    expect(serialized).toContain("team@bmc.org");
    expect(bedrock.modelIds).toEqual(["primary-model"]);
  });
  it("es: 200 with the translated title, es question wording and unchanged rule-out logic", async () => {
    mockFetchStudy(NCT);
    bedrock.queue = [goodProse(), goodProseEs()];
    const res = await POST(req({ nct: NCT, lang: "es" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lang).toBe("es");
    expect(body.title).toBe("THRIVE-DM en BMC");
    expect(body.summary).toContain("Participar es su elección");
    expect(body.checklistReason).toBeUndefined();
    expect(body.questions.map((q: { id: string }) => q.id).sort()).toEqual(HERO_IDS);
    const t2 = body.questions.find((q: { id: string }) => q.id === "t2dm_diagnosis");
    expect(t2.text).toBe("¿Tiene diabetes tipo 2?");
    expect(t2.ruleOutIf).toBe("no");
    const age = body.questions.find((q: { id: string }) => q.id === "age_min");
    expect(age.text).toBe("¿Tiene al menos 18 años?");
  });
  it("a model that injects its own questions cannot change the server checklist", async () => {
    mockFetchStudy(NCT);
    bedrock.queue = [
      goodProse({ questions: [{ id: "evil", text: "Do you have asthma?", ruleOutIf: "yes", source_criterion: "x", kind: "exclusion" }] }),
    ];
    const res = await POST(req({ nct: NCT, lang: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions.some((q: { id: string }) => q.id === "evil")).toBe(false);
    expect(body.questions.some((q: { text: string }) => /asthma/i.test(q.text))).toBe(false);
  });
  it("a model that injects questions/kind/ruleOutIf alongside VALID prose still yields only server questions", async () => {
    mockFetchStudy(NCT);
    bedrock.queue = [
      goodProse({
        questions: [
          { id: "age", text: "Are you at least 18 years old?", ruleOutIf: "yes", kind: "exclusion", source_criterion: "minimumAge = 18 years" },
          { id: "t2", text: "Do you NOT have type 2 diabetes?", ruleOutIf: "no", kind: "inclusion", source_criterion: "x" },
        ],
      }),
    ];
    const res = await POST(req({ nct: NCT, lang: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions.map((q: { id: string }) => q.id).sort()).toEqual(HERO_IDS);
    const age = body.questions.find((q: { id: string }) => q.id === "age_min");
    expect(age.kind).toBe("inclusion");
    expect(age.ruleOutIf).toBe("no");
    expect(body.questions.some((q: { text: string }) => /\bnot\b/i.test(q.text))).toBe(false);
  });
});
describe("summary without a checklist", () => {
  it("an unsupported study (same criteria, different nctId) gets 200 with title/summary and questions: []", async () => {
    // Same criteria text, but a study the mappings are NOT pinned to → only age_min (1) →
    // below MIN_SUPPORTED_QUESTIONS → no checklist, but the summary still ships.
    const other = "NCT10000001";
    mockFetchStudy(other);
    bedrock.queue = [goodProse()];
    const res = await POST(req({ nct: other, lang: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe(HERO_TITLE);
    expect(body.summary).toContain("Taking part is your choice");
    expect(body.whatItStudies).toBe(body.summary);
    expect(body.questions).toEqual([]);
    expect(body.checklistReason).toBe("unsupported-study");
  });
  it("an unsupported study in Spanish gets the translated title + summary and questions: []", async () => {
    const other = "NCT10000004";
    mockFetchStudy(other);
    bedrock.queue = [goodProse(), goodProseEs()];
    const res = await POST(req({ nct: other, lang: "es" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lang).toBe("es");
    expect(body.title).toBe("THRIVE-DM en BMC");
    expect(body.whatYouDo).toContain("617-555-0100");
    expect(body.questions).toEqual([]);
    expect(body.checklistReason).toBe("unsupported-study");
  });
  it("pt/ht/zh/vi get translated prose but no checklist questions (no reviewed wording)", async () => {
    for (const lang of ["pt", "ht", "zh", "vi"] as const) {
      mockFetchStudy(NCT);
      bedrock.queue = [goodProse(), JSON.stringify(OTHER_LANG_PROSE[lang])];
      const res = await POST(req({ nct: NCT, lang }));
      expect(res.status, lang).toBe(200);
      const body = await res.json();
      expect(body.lang).toBe(lang);
      expect(body.title).toBe(OTHER_LANG_PROSE[lang].title);
      expect(body.questions).toEqual([]);
      expect(body.checklistReason).toBe("unsupported-language");
    }
  });
  it("404 when the upstream has no study", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ studies: [] }), { status: 200 })));
    const res = await POST(req({ nct: "NCT10000002", lang: "en" }));
    expect(res.status).toBe(404);
  });
});
describe("retry once", () => {
  it("retries once on malformed prose, then succeeds on the second primary attempt", async () => {
    mockFetchStudy(NCT);
    bedrock.queue = ["not json at all", goodProse()];
    const res = await POST(req({ nct: NCT, lang: "en" }));
    expect(res.status).toBe(200);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model"]);
  });
  it("schema-invalid JSON (valid JSON, missing required prose) retries then succeeds", async () => {
    mockFetchStudy(NCT);
    bedrock.queue = [JSON.stringify({ summary: "A study." }), goodProse()];
    const res = await POST(req({ nct: NCT, lang: "en" }));
    expect(res.status).toBe(200);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model"]);
  });
  it("invalid output twice → 503 after exactly one retry (never a partial body)", async () => {
    mockFetchStudy(NCT);
    const schemaInvalid = JSON.stringify({ summary: "A study." });
    bedrock.queue = [schemaInvalid, schemaInvalid, schemaInvalid];
    const res = await POST(req({ nct: NCT, lang: "en" }));
    expect(res.status).toBe(503);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model"]);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.summary).toBeUndefined();
    expect(body.whatItStudies).toBeUndefined();
    expect(body.questions).toBeUndefined();
  });
  it("unsafe prose (forbidden phrase) twice → 503", async () => {
    mockFetchStudy(NCT);
    const unsafe = goodProse({ whatYouDo: "You qualify for this trial." });
    bedrock.queue = [unsafe, unsafe];
    const res = await POST(req({ nct: NCT, lang: "en" }));
    expect(res.status).toBe(503);
  });
  it("a failed CALL is retried once on the fallback model; both aborting → 503", async () => {
    mockFetchStudy(NCT);
    const aborter: SendBehavior = () =>
      Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    bedrock.queue = [aborter, aborter, aborter];
    const res = await POST(req({ nct: NCT, lang: "en" }));
    expect(res.status).toBe(503);
    expect(bedrock.modelIds).toEqual(["primary-model", "fallback-model"]);
  });
  it("503 when the prose translation introduces a new number (invariant), after one retry", async () => {
    mockFetchStudy(NCT);
    const badEs = goodProseEs({ timeCommitment: "Unas 4 visitas durante 99 meses." }); // 99 not in English
    bedrock.queue = [goodProse(), badEs, badEs, badEs];
    const res = await POST(req({ nct: NCT, lang: "es" }));
    expect(res.status).toBe(503);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model", "primary-model"]);
    expect((await res.json()).summary).toBeUndefined();
  });
});
describe("title / summary / whatYouDo validation", () => {
  const CODE_NCT = "NCT10000003";
  const CODE_TITLE = "A Study of LY5724886 in Adults With Type 2 Diabetes";
  const esFor = (title: string) => goodProseEs({ title });
  it("a translated title that changes a study code is retried; the faithful one ships", async () => {
    mockFetchStudy(CODE_NCT, CODE_TITLE);
    bedrock.queue = [
      goodProse(),
      esFor("Un estudio de LY-5724886 en adultos con diabetes tipo 2"), // code split
      esFor("Un estudio de LY5724886 en adultos con diabetes tipo 2"),
    ];
    const res = await POST(req({ nct: CODE_NCT, lang: "es" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Un estudio de LY5724886 en adultos con diabetes tipo 2");
    expect(bedrock.modelIds).toHaveLength(3);
  });
  it("a translated title that drops a number twice → 503", async () => {
    mockFetchStudy(CODE_NCT, CODE_TITLE);
    const noNumber = esFor("Un estudio de LY5724886 en adultos con diabetes");
    bedrock.queue = [goodProse(), noNumber, noNumber];
    const res = await POST(req({ nct: CODE_NCT, lang: "es" }));
    expect(res.status).toBe(503);
  });
  it("a banned word from ANOTHER language in the Spanish output is rejected", async () => {
    mockFetchStudy(NCT);
    const zhLeak = goodProseEs({ whatYouDo: "Usted visita la clínica. 您符合条件. Llame al 617-555-0100." });
    bedrock.queue = [goodProse(), zhLeak, zhLeak];
    const res = await POST(req({ nct: NCT, lang: "es" }));
    expect(res.status).toBe(503);
  });
  it("an empty translated title is rejected", async () => {
    mockFetchStudy(NCT);
    const empty = goodProseEs({ title: "   " });
    bedrock.queue = [goodProse(), empty, empty];
    const res = await POST(req({ nct: NCT, lang: "es" }));
    expect(res.status).toBe(503);
  });
});
describe("caching", () => {
  it("separates cache by language and does not re-invoke Bedrock on a repeat call", async () => {
    mockFetchStudy(NCT);
    bedrock.queue = [goodProse()];
    const en1 = await POST(req({ nct: NCT, lang: "en" }));
    expect(en1.status).toBe(200);
    expect(bedrock.modelIds).toHaveLength(1);
    const en2 = await POST(req({ nct: NCT, lang: "en" }));
    expect(en2.status).toBe(200);
    expect(bedrock.modelIds).toHaveLength(1);
    // Spanish reuses the cached English prose: only the translation call is made.
    bedrock.queue = [goodProseEs()];
    const es = await POST(req({ nct: NCT, lang: "es" }));
    expect(es.status).toBe(200);
    expect((await es.json()).lang).toBe("es");
    expect(bedrock.modelIds).toHaveLength(2);
    const es2 = await POST(req({ nct: NCT, lang: "es" }));
    expect(es2.status).toBe(200);
    expect(bedrock.modelIds).toHaveLength(2);
  });
  it("does not cache a failure", async () => {
    mockFetchStudy(NCT);
    bedrock.queue = ["bad", "bad"];
    const fail = await POST(req({ nct: NCT, lang: "en" }));
    expect(fail.status).toBe(503);
    bedrock.queue = [goodProse()];
    const ok = await POST(req({ nct: NCT, lang: "en" }));
    expect(ok.status).toBe(200);
  });
});
