import { describe, expect, it, vi } from "vitest";
import { getTrials } from "./data";
import { searchMockTrials } from "./mock/search";

// lib/data.ts is server-only. These stubs let Vitest load it; mock mode never calls headers().
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

describe("getTrials with mocks on", () => {
  it("runs the mock search the results page uses, so the hero search finds NCT07043426", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const q = { cond: "type 2 diabetes", lat: 42.3016, lon: -71.0676, radius: 10 };
    const r = await getTrials(q, true);
    expect(r).toEqual(searchMockTrials(q));
    expect(r.trials[0]?.nctId).toBe("NCT07043426");
    expect(fetchSpy).not.toHaveBeenCalled(); // mock mode never calls the API
    fetchSpy.mockRestore();
  });
});
