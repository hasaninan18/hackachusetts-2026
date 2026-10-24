// Tests for POST /api/simplify (spec: simplify).
//
// The route is the I/O layer, so two things are mocked: the upstream `fetch`
// (ClinicalTrials.gov) and the Bedrock SDK's ConverseCommand transport. NO live Bedrock
// call is ever made. The Bedrock mock is a queue of responses so each test controls
// exactly what the model "returns" and we can assert retry/fallback/timeout behavior.
//
// The upstream cache in lib/cache.ts is module-scoped and keyed by NCT id, so tests that
// need a DISTINCT upstream result (e.g. the 404 case) use a distinct NCT id to avoid
// cache bleed — mirroring the pattern in app/api/trials/route.test.ts.
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
            eligibilityCriteria: "Inclusion: Age 18 or older. Type 2 diabetes. Exclusion: hospice care.",
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

function goodModel(extra: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    summary:
      "This study at Boston Medical Center looks at type 2 diabetes. You may be put by chance in a group that gets usual care. Taking part is your choice.",
    whatYouDo: "You visit the clinic and answer questions. Call 617-555-0100 or email team@bmc.org.",
    timeCommitment: "About 4 visits over 6 months.",
    questions: [
      { id: "q1", text: "Are you 18 years or older?", ruleOutIf: "no", source_criterion: "minimumAge = 18 years", kind: "inclusion" },
      { id: "q2", text: "Do you have type 2 diabetes?", ruleOutIf: "no", source_criterion: "Type 2 diabetes", kind: "inclusion" },
      { id: "q3", text: "Are you in hospice care?", ruleOutIf: "yes", source_criterion: "hospice care", kind: "exclusion" },
    ],
    staff_checks: ["The study team will check your labs."],
    ...extra,
  });
}

/** Mock a successful upstream fetch returning the study body for the given NCT. */
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
  it("200 with the frontend contract fields and preserved identifiers", async () => {
    const nct = "NCT10000001";
    mockFetchStudy(nct);
    bedrock.queue = [goodModel()];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.whatItStudies).toBeTruthy();
    expect(body.whatYouDo).toBeTruthy();
    expect(body.lang).toBe("en");
    expect(Array.isArray(body.questions)).toBe(true);
    expect(body.questions.length).toBeGreaterThanOrEqual(3);
    for (const q of body.questions) {
      expect(["yes", "no"]).toContain(q.ruleOutIf);
    }
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("617-555-0100");
    expect(serialized).toContain("team@bmc.org");
    expect(bedrock.modelIds).toEqual(["primary-model"]);
  });

  it("404 when the upstream has no study", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ studies: [] }), { status: 200 })));
    const res = await POST(req({ nct: "NCT10000002", lang: "en" }));
    expect(res.status).toBe(404);
  });
});

describe("retry + fallback bounds", () => {
  it("retries once on malformed output, then succeeds on the second primary attempt", async () => {
    const nct = "NCT10000003";
    mockFetchStudy(nct);
    bedrock.queue = ["not json at all", goodModel()];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(200);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model"]);
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
    bedrock.queue = [goodModel()];
    const en1 = await POST(req({ nct, lang: "en" }));
    expect(en1.status).toBe(200);
    const enCalls = bedrock.modelIds.length;

    const en2 = await POST(req({ nct, lang: "en" }));
    expect(en2.status).toBe(200);
    expect(bedrock.modelIds.length).toBe(enCalls);

    bedrock.queue = [goodModel(), goodModel()];
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
    bedrock.queue = [goodModel()];
    const ok = await POST(req({ nct, lang: "en" }));
    expect(ok.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Translation invariants at the route (Task 2/4). English generates, the translation
// violates a structural invariant, so the bounded retry/fallback runs and the route ends
// in a safe 503 — never a fabricated or structurally-broken summary.
// ---------------------------------------------------------------------------
function goodModelObj() {
  return JSON.parse(goodModel()) as {
    questions: Array<{ id: string; text: string; ruleOutIf: string; source_criterion: string; kind: string }>;
    [k: string]: unknown;
  };
}
/** A faithful Spanish translation: only text changes, structure identical. */
function faithfulTranslation() {
  const m = goodModelObj();
  return JSON.stringify({ ...m, questions: m.questions.map((q) => ({ ...q, text: `(es) ${q.text}` })) });
}
/** A translation that REORDERS the questions — must be rejected. */
function reorderedTranslation() {
  const m = goodModelObj();
  const qs = m.questions.map((q) => ({ ...q, text: `(es) ${q.text}` }));
  return JSON.stringify({ ...m, questions: [qs[1], qs[0], qs[2]] });
}
/** A translation that TRANSLATES source_criterion — must be rejected. */
function translatedCriterion() {
  const m = goodModelObj();
  const qs = m.questions.map((q, i) => (i === 0 ? { ...q, source_criterion: "Edad 18 o mas" } : q));
  return JSON.stringify({ ...m, questions: qs });
}

describe("translation invariants (route)", () => {
  it("503 when the translation reorders questions, after bounded retry+fallback", async () => {
    const nct = "NCT20000001";
    mockFetchStudy(nct);
    // 1 English (good) + 3 translation attempts (all reordered → rejected).
    bedrock.queue = [goodModel(), reorderedTranslation(), reorderedTranslation(), reorderedTranslation()];
    const res = await POST(req({ nct, lang: "es" }));
    expect(res.status).toBe(503);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model", "primary-model", "fallback-model"]);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.summary).toBeUndefined();
  });

  it("503 when the translation TRANSLATES source_criterion (it must stay English)", async () => {
    const nct = "NCT20000002";
    mockFetchStudy(nct);
    bedrock.queue = [goodModel(), translatedCriterion(), translatedCriterion(), translatedCriterion()];
    const res = await POST(req({ nct, lang: "es" }));
    expect(res.status).toBe(503);
  });

  it("200 and keeps source_criterion in ENGLISH when the translation is faithful", async () => {
    const nct = "NCT20000003";
    mockFetchStudy(nct);
    bedrock.queue = [goodModel(), faithfulTranslation()];
    const res = await POST(req({ nct, lang: "es" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lang).toBe("es");
    const english = goodModelObj();
    for (const q of body.questions as Array<{ id: string; source_criterion: string }>) {
      const en = english.questions.find((e) => e.id === q.id);
      expect(q.source_criterion).toBe(en?.source_criterion);
    }
  });
});

// ---------------------------------------------------------------------------
// source_criterion grounding at the route (Task 3/4): a fabricated quote is rejected,
// and a legitimate structured-age question is accepted.
// ---------------------------------------------------------------------------
describe("source_criterion grounding (route)", () => {
  it("503 when a source_criterion is fabricated (not present in the criteria)", async () => {
    const nct = "NCT20000004";
    mockFetchStudy(nct);
    const fabricated = goodModel({
      questions: [
        { id: "q1", text: "x?", ruleOutIf: "no", source_criterion: "Must own a red car", kind: "inclusion" },
        { id: "q2", text: "diabetes?", ruleOutIf: "no", source_criterion: "Type 2 diabetes", kind: "inclusion" },
        { id: "q3", text: "hospice?", ruleOutIf: "yes", source_criterion: "hospice care", kind: "exclusion" },
      ],
    });
    bedrock.queue = [fabricated, fabricated, fabricated];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(503);
    expect(bedrock.modelIds).toEqual(["primary-model", "primary-model", "fallback-model"]);
  });

  it("200 for a legitimate STRUCTURED-age question with no verbatim free-text match", async () => {
    const nct = "NCT20000005";
    mockFetchStudy(nct);
    // minimumAge "18 Years" is structured; criteria free text has no age phrase matching this quote.
    const structuredAge = goodModel({
      questions: [
        { id: "q1", text: "Are you 18 or older?", ruleOutIf: "no", source_criterion: "minimumAge = 18 years", kind: "inclusion" },
        { id: "q2", text: "diabetes?", ruleOutIf: "no", source_criterion: "Type 2 diabetes", kind: "inclusion" },
        { id: "q3", text: "hospice?", ruleOutIf: "yes", source_criterion: "hospice care", kind: "exclusion" },
      ],
    });
    bedrock.queue = [structuredAge];
    const res = await POST(req({ nct, lang: "en" }));
    expect(res.status).toBe(200);
    expect(bedrock.modelIds).toEqual(["primary-model"]);
  });
});
