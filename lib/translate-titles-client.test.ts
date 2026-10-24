// Browser-side helper tests: never blocks, falls back to English (null) on any failure.
// `fetch` is injected; no network.
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_BATCH_SIZE,
  MAX_TITLE_ITEMS,
  chunk,
  parseTitlesResponse,
  requestTitleTranslations,
  startTitleTranslations,
  toTitleItem,
  wantsTitleTranslation,
  type TitleItem,
  type TitleTranslation,
} from "./translate-titles-client";
import { LANGS } from "./types";

const ITEMS: TitleItem[] = [
  { nctId: "NCT00000001", title: "Study of RO7795068", conditions: ["Obesity"] },
  { nctId: "NCT00000002", title: "Asthma study", conditions: [] },
];
const OK_BODY = {
  lang: "es",
  items: [
    { nctId: "NCT00000001", title: "Estudio de RO7795068", conditions: ["Obesidad"] },
    { nctId: "NCT00000002", title: "Estudio de asma", conditions: [] },
  ],
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.useRealTimers());

describe("what is sent", () => {
  it("only non-English languages are translated", () => {
    expect(LANGS.filter(wantsTitleTranslation)).toEqual(["es", "pt", "ht", "zh", "vi"]);
  });

  it("toTitleItem keeps only registry text and the two conditions the list shows", () => {
    const trial = {
      nctId: "NCT00000001",
      title: "T",
      conditions: ["a", "b", "c"],
      phase: "Phase 2",
      distanceMi: 2,
      nearestSite: { name: "BMC", city: "Boston", lat: 1, lon: 2, locationPrecision: "city" as const },
    };
    expect(toTitleItem(trial)).toEqual({ nctId: "NCT00000001", title: "T", conditions: ["a", "b"] });
  });

  it("request body holds only lang + items with nctId/title/conditions", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(OK_BODY));
    const sneaky = ITEMS.map((i) => ({ ...i, answers: { q1: "yes" } })) as unknown as TitleItem[];
    await requestTitleTranslations({ lang: "es", items: sneaky, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/translate-titles");
    const sent = JSON.parse(String(init?.body));
    expect(Object.keys(sent).sort()).toEqual(["items", "lang"]);
    for (const item of sent.items) expect(Object.keys(item).sort()).toEqual(["conditions", "nctId", "title"]);
  });

  it("chunk keeps order and never exceeds the batch size (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 80 }), fc.integer({ min: 1, max: MAX_TITLE_ITEMS }), (xs, n) => {
        const parts = chunk(xs, n);
        expect(parts.flat()).toEqual(xs);
        expect(parts.every((p) => p.length >= 1 && p.length <= n)).toBe(true);
      }),
    );
    expect(CLIENT_BATCH_SIZE).toBeLessThanOrEqual(MAX_TITLE_ITEMS);
  });
});

describe("parseTitlesResponse", () => {
  it("keeps good items, ignores unknown ids, wrong language, and bad shapes", () => {
    const r = parseTitlesResponse(
      {
        lang: "es",
        items: [
          OK_BODY.items[0],
          { nctId: "NCT99999999", title: "x", conditions: [] },
          { nctId: "NCT00000002", title: "", conditions: [] },
        ],
      },
      "es",
      ITEMS,
    );
    expect([...(r ?? new Map()).keys()]).toEqual(["NCT00000001"]);
    expect(parseTitlesResponse({ ...OK_BODY, lang: "pt" }, "es", ITEMS)).toBeNull();
    expect(parseTitlesResponse(null, "es", ITEMS)).toBeNull();
  });

  it("never throws, and only returns requested ids (property)", () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const r = parseTitlesResponse(v, "es", ITEMS);
        if (r) for (const id of r.keys()) expect(ITEMS.map((i) => i.nctId)).toContain(id);
      }),
    );
  });
});

describe("requestTitleTranslations falls back to English (null)", () => {
  it("returns the translations on success", async () => {
    const r = await requestTitleTranslations({ lang: "es", items: ITEMS, fetchImpl: async () => jsonResponse(OK_BODY) });
    expect(r?.get("NCT00000001")?.title).toBe("Estudio de RO7795068");
  });

  it.each([
    ["HTTP 503", async () => jsonResponse({ error: "x" }, 503)],
    ["HTTP 400", async () => jsonResponse({ error: "x" }, 400)],
    ["network error", async () => Promise.reject(new TypeError("failed to fetch"))],
    ["non-JSON body", async () => new Response("<html>", { status: 200 })],
  ] as const)("on %s", async (_name, impl) => {
    const r = await requestTitleTranslations({ lang: "es", items: ITEMS, fetchImpl: impl as typeof fetch });
    expect(r).toBeNull();
  });

  it("on timeout, even when fetch ignores the abort signal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_u, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const pending = requestTitleTranslations({ lang: "es", items: ITEMS, fetchImpl, timeoutMs: 18000 });
    await vi.advanceTimersByTimeAsync(18000);
    await expect(pending).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it("when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      requestTitleTranslations({ lang: "es", items: ITEMS, fetchImpl, signal: controller.signal }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("startTitleTranslations never blocks", () => {
  it("returns synchronously while requests are still pending", () => {
    const request = vi.fn(() => new Promise<Map<string, TitleTranslation> | null>(() => {}));
    const onUpdate = vi.fn();
    const ret = startTitleTranslations({
      lang: "es",
      items: Array.from({ length: 23 }, (_, i) => ({ nctId: `NCT${String(i).padStart(8, "0")}`, title: "t", conditions: [] })),
      signal: new AbortController().signal,
      onUpdate,
      request,
    });
    expect(ret).toBeUndefined(); // not a promise: nothing to await
    expect(request).toHaveBeenCalledTimes(3); // 10 + 10 + 3, sent in parallel
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("merges batches as they land and skips failed ones", async () => {
    const results: Array<Map<string, TitleTranslation> | null> = [
      new Map([["A", { title: "a", conditions: [] }]]),
      null,
      new Map([["C", { title: "c", conditions: [] }]]),
    ];
    const request = vi.fn(async () => results.shift() ?? null);
    const updates: string[][] = [];
    startTitleTranslations({
      lang: "pt",
      items: ["A", "B", "C"].map((nctId) => ({ nctId, title: nctId, conditions: [] })),
      signal: new AbortController().signal,
      onUpdate: (m) => updates.push([...m.keys()]),
      request,
      batchSize: 1,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(updates).toEqual([["A"], ["A", "C"]]);
  });

  it("reports nothing after abort (language switch / unmount)", async () => {
    const controller = new AbortController();
    const onUpdate = vi.fn();
    startTitleTranslations({
      lang: "es",
      items: ITEMS,
      signal: controller.signal,
      onUpdate,
      request: async () => new Map([["NCT00000001", { title: "x", conditions: ["y"] }]]),
    });
    controller.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
