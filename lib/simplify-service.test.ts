// lib/simplify-service.ts with a mocked Bedrock `converse`, a mocked shared cache, and a
// stubbed upstream fetch. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Converse } from "./bedrock";
import type { SharedCache } from "./shared-cache";
import { sourceHash, type CachedTranslation } from "./simplify-auto";
import { criteriaRevisionHash } from "./simplify-mappings";
import { simplifyCacheKey, simplifyTrial } from "./simplify-service";
import { HERO_CRITERIA, heroCriteriaWithHospice } from "./test-fixtures/nct07043426";
import { toDetail } from "./clinicaltrials";
import type { CtgStudy } from "./api-types";

const NCT = "NCT07043426";
const HASH = criteriaRevisionHash(HERO_CRITERIA);
const HERO_IDS = ["age_min", "hospice", "t1dm_exclusion", "t2dm_diagnosis"];

const ENGLISH = {
  summary: "This study at Boston Medical Center looks at type 2 diabetes. Taking part is your choice.",
  whatYouDo: "You visit the clinic. Call 617-555-0100.",
  timeCommitment: "About 4 visits over 6 months.",
  staff_checks: [],
};
const SPANISH = {
  title: "THRIVE-DM en BMC",
  summary: "Este estudio en Boston Medical Center analiza la diabetes tipo 2. Participar es su elección.",
  whatYouDo: "Usted visita la clínica. Llame al 617-555-0100.",
  timeCommitment: "Unas 4 visitas durante 6 meses.",
  staff_checks: [],
};

function rawStudy(criteria = HERO_CRITERIA): CtgStudy {
  return {
    protocolSection: {
      identificationModule: { nctId: NCT, briefTitle: "THRIVE-DM at BMC" },
      conditionsModule: { conditions: ["Type 2 Diabetes"] },
      descriptionModule: { briefSummary: "A diabetes study. Call 617-555-0100." },
      eligibilityModule: { eligibilityCriteria: criteria, sex: "ALL", minimumAge: "18 Years", healthyVolunteers: false },
      contactsLocationsModule: {
        locations: [{ facility: "Boston Medical Center", city: "Boston", state: "Massachusetts", zip: "02118", status: "RECRUITING", geoPoint: { lat: 42.335, lon: -71.0728 } }],
        centralContacts: [{ name: "Study Team", phone: "617-555-0100" }],
      },
    },
  } as CtgStudy;
}
const SOURCE_HASH = sourceHash(toDetail(rawStudy()));

function entry(over: Partial<CachedTranslation> = {}): CachedTranslation {
  const { title, ...prose } = SPANISH;
  return {
    v: 2,
    nctId: NCT,
    lang: "es",
    criteriaHash: HASH,
    sourceHash: SOURCE_HASH,
    createdAt: Date.now() - 1000,
    title,
    prose,
    ...over,
  };
}

function fakeCache(seed: Record<string, unknown> = {}): SharedCache & { store: Map<string, unknown> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k)) as SharedCache["get"],
    set: vi.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
    clearMemory: () => store.clear(),
  };
}

function stubStudy(criteria = HERO_CRITERIA) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ studies: [rawStudy(criteria)] }), { status: 200 })));
}

beforeEach(() => {
  stubStudy();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("simplifyTrial + shared cache", () => {
  it("a cache hit never calls Bedrock and still gets the LIVE checklist (never a cached one)", async () => {
    const cache = fakeCache({ [simplifyCacheKey(NCT, "es", HASH)]: entry() });
    const converse = vi.fn<Converse>();
    const result = await simplifyTrial(NCT, "es", { converse, cache });
    expect(converse).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.title).toBe("THRIVE-DM en BMC");
    expect(result.body.summary).toBe(SPANISH.summary);
    expect(result.body.questions.map((q) => q.id).sort()).toEqual(HERO_IDS);
    expect(result.body.questions.find((q) => q.id === "t2dm_diagnosis")?.text).toBe("¿Tiene diabetes tipo 2?");
  });

  it("questions smuggled into a cached entry are ignored", async () => {
    const poisoned = { ...entry(), questions: [{ id: "evil", text: "Do you qualify?", ruleOutIf: "no" }] };
    const cache = fakeCache({ [simplifyCacheKey(NCT, "es", HASH)]: poisoned });
    const result = await simplifyTrial(NCT, "es", { converse: vi.fn<Converse>(), cache });
    expect(result.ok && result.body.questions.map((q) => q.id).sort()).toEqual(HERO_IDS);
  });

  it("the key includes nctId, lang and the criteria-revision hash", () => {
    expect(simplifyCacheKey(NCT, "es", HASH)).toBe(`simplify:v2:${NCT}:es:${HASH}`);
    expect(simplifyCacheKey(NCT, "es", HASH)).not.toBe(simplifyCacheKey(NCT, "pt", HASH));
    expect(simplifyCacheKey(NCT, "es", HASH)).not.toBe(simplifyCacheKey(NCT, "es", "other-hash"));
  });

  it.each([
    ["another study", { nctId: "NCT10000001" }],
    ["another language", { lang: "pt" as const }],
    ["changed registry text", { sourceHash: "0".repeat(64) }],
    ["older than 24 hours", { createdAt: Date.now() - 24 * 60 * 60 * 1000 - 1 }],
    ["a malformed prose", { prose: { summary: "" } as unknown as CachedTranslation["prose"] }],
  ])("an entry for %s is treated as a miss and regenerated", async (_name, over) => {
    const cache = fakeCache({ [simplifyCacheKey(NCT, "es", HASH)]: entry(over) });
    const converse = vi
      .fn<Converse>()
      .mockResolvedValueOnce(JSON.stringify(ENGLISH))
      .mockResolvedValueOnce(JSON.stringify({ ...SPANISH, title: "Nuevo título THRIVE-DM" }));
    const result = await simplifyTrial(NCT, "es", { converse, cache });
    expect(converse).toHaveBeenCalledTimes(2);
    expect(result.ok && result.body.title).toBe("Nuevo título THRIVE-DM");
  });

  it("a miss generates, then caches only title + prose for the language and for English", async () => {
    const cache = fakeCache();
    const converse = vi
      .fn<Converse>()
      .mockResolvedValueOnce(JSON.stringify(ENGLISH))
      .mockResolvedValueOnce(JSON.stringify(SPANISH));
    const result = await simplifyTrial(NCT, "es", { converse, cache, primaryModel: "p", fallbackModel: "f" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.title).toBe("THRIVE-DM en BMC");
    expect(result.body.questions.map((q) => q.id).sort()).toEqual(HERO_IDS);
    const es = cache.store.get(simplifyCacheKey(NCT, "es", HASH)) as CachedTranslation;
    const en = cache.store.get(simplifyCacheKey(NCT, "en", HASH)) as CachedTranslation;
    expect(es).toMatchObject({ v: 2, nctId: NCT, lang: "es", criteriaHash: HASH, sourceHash: SOURCE_HASH, title: SPANISH.title });
    expect(en).toMatchObject({ lang: "en", title: "THRIVE-DM at BMC", prose: ENGLISH });
    expect(es).not.toHaveProperty("questions");
    expect(en).not.toHaveProperty("questions");
  });

  it("cached English prose is reused, so another language costs one Bedrock call", async () => {
    const enEntry = entry({ lang: "en", title: "THRIVE-DM at BMC", prose: ENGLISH });
    const cache = fakeCache({ [simplifyCacheKey(NCT, "en", HASH)]: enEntry });
    const converse = vi.fn<Converse>(async () => JSON.stringify({ ...SPANISH, title: "THRIVE-DM no BMC" }));
    const result = await simplifyTrial(NCT, "pt", { converse, cache });
    expect(converse).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.questions).toEqual([]);
      expect(result.body.checklistReason).toBe("unsupported-language");
    }
  });

  it("a failure is not cached", async () => {
    const cache = fakeCache();
    const converse = vi.fn<Converse>(async () => "not json");
    const result = await simplifyTrial(NCT, "en", { converse, cache });
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(converse).toHaveBeenCalledTimes(2); // one call + one retry
    expect(cache.set).not.toHaveBeenCalled();
  });
});

describe("checklist reasons through the service", () => {
  it("revised hero criteria: summary still ships, questions: [] with criteria-revision-changed", async () => {
    vi.resetModules(); // fresh upstream cache, so the revised registry text is loaded
    const { simplifyTrial: fresh } = await import("./simplify-service");
    stubStudy(heroCriteriaWithHospice("Patients not currently receiving hospice care."));
    const converse = vi.fn<Converse>(async () => JSON.stringify(ENGLISH));
    const result = await fresh(NCT, "en", { converse, cache: fakeCache() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.summary).toBe(ENGLISH.summary);
    expect(result.body.questions).toEqual([]);
    expect(result.body.checklistReason).toBe("criteria-revision-changed");
  });
});
