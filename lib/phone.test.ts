import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { telHref } from "./phone";

describe("telHref", () => {
  it.each([
    ["617-525-8266", "tel:6175258266"],
    ["(+1) 866-867-7178", "tel:+18668677178"],
    ["1-877-CTLILLY (1-877-285-4559)", "tel:18772854559"],
    ["617-726-4400 ext 123", "tel:6177264400,123"],
    ["1-800-FLOWERS", null],
    ["12345", null],
    ["", null],
  ])("%s → %s", (input, expected) => {
    expect(telHref(input)).toBe(expected);
  });

  it("never invents digits: the href's digits appear in order in the input", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(..."0123456789-() +.extEXTabc".split("")) }), (s) => {
        const href = telHref(s);
        if (href === null) return;
        expect(href).toMatch(/^tel:\+?\d{7,}(,\d+)?$/);
        const out = href.replace(/\D/g, "");
        let i = 0;
        for (const ch of s.replace(/\D/g, "")) if (ch === out[i]) i++;
        expect(i).toBe(out.length);
      }),
    );
  });
});
