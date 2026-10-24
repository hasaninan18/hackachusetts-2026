// Tests for POST /api/translate-titles. The Bedrock SDK transport is mocked with a queue of
// responses (same pattern as app/api/simplify/route.test.ts); no live call is ever made.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SendBehavior = string | Error;
const bedrock = {
  queue: [] as SendBehavior[],
  calls: [] as Array<{ modelId: string; maxTokens?: number; user: string }>,
};
vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  class ConverseCommand {
    constructor(
      public input: {
        modelId: string;
        inferenceConfig?: { maxTokens?: number };
        messages: Array<{ content: Array<{ text: string }> }>;
      },
    ) {}
  }
  class BedrockRuntimeClient {
    async send(command: ConverseCommand): Promise<unknown> {
      bedrock.calls.push({
        modelId: command.input.modelId,
        maxTokens: command.input.inferenceConfig?.maxTokens,
        user: command.input.messages[0].content[0].text,
      });
      const next = bedrock.queue.shift();
      if (next === undefined) throw new Error("no mock Bedrock response queued");
      if (next instanceof Error) throw next;
      return { output: { message: { content: [{ text: next }] } } };
    }
  }
  return { BedrockRuntimeClient, ConverseCommand };
});

import { clearTitleCache } from "../../../lib/translate-titles";
import { POST } from "./route";

const ITEMS = [
  { nctId: "NCT07351045", title: "A Study of Enicepatide (RO7795068) in Obesity", conditions: ["Obesity"] },
  { nctId: "NCT07392190", title: "A Study of Eloralintide (LY3841136)", conditions: ["Overweight", "Obesity"] },
];
const ES = [
  { nctId: "NCT07351045", title: "Un estudio de enicepatida (RO7795068) en la obesidad", conditions: ["Obesidad"] },
  { nctId: "NCT07392190", title: "Un estudio de eloralintida (LY3841136)", conditions: ["Sobrepeso", "Obesidad"] },
];

function req(body: unknown): Request {
  return new Request("http://localhost/api/translate-titles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  bedrock.queue = [];
  bedrock.calls = [];
  clearTitleCache();
  vi.stubEnv("BEDROCK_MODEL_ID", "primary-model");
  vi.stubEnv("BEDROCK_FALLBACK_MODEL_ID", "fallback-model");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/translate-titles — request validation", () => {
  it.each([
    ["non-JSON body", "{not json"],
    ["lang en", { lang: "en", items: ITEMS }],
    ["unknown lang", { lang: "fr", items: ITEMS }],
    ["no items", { lang: "es", items: [] }],
    ["26 items", { lang: "es", items: Array.from({ length: 26 }, (_, i) => ({ nctId: `NCT${String(i).padStart(8, "0")}`, title: "t", conditions: [] })) }],
    ["extra field", { lang: "es", items: ITEMS, answers: ["yes"] }],
  ])("400 for %s, without calling Bedrock", async (_name, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(bedrock.calls).toHaveLength(0);
  });
});

describe("POST /api/translate-titles — translation", () => {
  it("one Converse call, returns the items in order", async () => {
    bedrock.queue.push(JSON.stringify({ items: ES }));
    const res = await POST(req({ lang: "es", items: ITEMS }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lang: "es", items: ES });
    expect(bedrock.calls).toHaveLength(1);
    expect(bedrock.calls[0].modelId).toBe("primary-model");
    expect(bedrock.calls[0].maxTokens).toBeGreaterThan(1500);
    expect(bedrock.calls[0].user).toContain("RO7795068");
  });

  it("drops an item that lost its code, so it shows English", async () => {
    bedrock.queue.push(JSON.stringify({ items: [ES[0], { ...ES[1], title: "Un estudio de eloralintida" }] }));
    const res = await POST(req({ lang: "es", items: ITEMS }));
    expect(await res.json()).toEqual({ lang: "es", items: [ES[0]] });
  });

  it("retries once on invalid JSON, on the fallback model", async () => {
    bedrock.queue.push("Sure! Here are the titles.", JSON.stringify({ items: ES }));
    const res = await POST(req({ lang: "es", items: ITEMS }));
    expect(res.status).toBe(200);
    expect(bedrock.calls.map((c) => c.modelId)).toEqual(["primary-model", "fallback-model"]);
  });

  it("503 when Bedrock fails twice (client keeps English)", async () => {
    bedrock.queue.push(new Error("throttled"), "not json");
    const res = await POST(req({ lang: "zh", items: ITEMS }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect(bedrock.calls).toHaveLength(2);
  });

  it("caches per (nctId, lang): a repeat makes no call; a new language does", async () => {
    bedrock.queue.push(JSON.stringify({ items: ES }));
    await POST(req({ lang: "es", items: ITEMS }));
    const again = await POST(req({ lang: "es", items: [ITEMS[1]] }));
    expect(await again.json()).toEqual({ lang: "es", items: [ES[1]] });
    expect(bedrock.calls).toHaveLength(1);

    bedrock.queue.push(JSON.stringify({ items: [{ ...ITEMS[0], title: "Um estudo de enicepatida (RO7795068) na obesidade", conditions: ["Obesidade"] }] }));
    await POST(req({ lang: "pt", items: [ITEMS[0]] }));
    expect(bedrock.calls).toHaveLength(2);
  });

  it("only sends uncached items to Bedrock, and still returns cached ones if it fails", async () => {
    bedrock.queue.push(JSON.stringify({ items: [ES[0]] }));
    await POST(req({ lang: "es", items: [ITEMS[0]] }));
    bedrock.queue.push(new Error("down"), new Error("down"));
    const res = await POST(req({ lang: "es", items: ITEMS }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lang: "es", items: [ES[0]] });
    expect(bedrock.calls[1].user).not.toContain("NCT07351045");
    expect(bedrock.calls[1].user).toContain("NCT07392190");
  });

  it("a different English title for the same id is not served from cache", async () => {
    bedrock.queue.push(JSON.stringify({ items: [ES[0]] }));
    await POST(req({ lang: "es", items: [ITEMS[0]] }));
    bedrock.queue.push("bad", "bad");
    const res = await POST(req({ lang: "es", items: [{ ...ITEMS[0], title: "Something else entirely" }] }));
    expect(res.status).toBe(503);
  });
});
