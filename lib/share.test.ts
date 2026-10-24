import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { shareUrl } from "./share";

describe("shareUrl", () => {
  it("keeps the trial page and drops the search that led to it", () => {
    expect(
      shareUrl(
        "https://trialpath-ma.vercel.app/es/trial/NCT07043426?cond=type+2+diabetes&lat=42.29&lon=-71.08&radius=10&from=42.29,-71.08#contact",
      ),
    ).toBe("https://trialpath-ma.vercel.app/es/trial/NCT07043426");
  });

  it("keeps mock=1 so a demo link opens the same fixture", () => {
    expect(shareUrl("http://localhost:3000/en/trial/NCT07043426?cond=diabetes&mock=1")).toBe(
      "http://localhost:3000/en/trial/NCT07043426?mock=1",
    );
    expect(shareUrl("http://localhost:3000/en/trial/NCT07043426?mock=0")).toBe(
      "http://localhost:3000/en/trial/NCT07043426",
    );
  });

  it("never carries the condition or coordinates, whatever the query holds", () => {
    const value = fc.string({ minLength: 1, maxLength: 20 });
    fc.assert(
      fc.property(value, value, value, (cond, lat, lon) => {
        const qs = new URLSearchParams({ cond, lat, lon, radius: "5" });
        const out = new URL(shareUrl(`https://example.org/pt/trial/NCT05784922?${qs}`));
        expect(out.pathname).toBe("/pt/trial/NCT05784922");
        expect([...out.searchParams.keys()]).toEqual([]);
        expect(out.hash).toBe("");
      }),
    );
  });
});
