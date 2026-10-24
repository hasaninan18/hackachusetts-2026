import { describe, expect, it } from "vitest";
import { LANGS } from "../types";
import { dictionaries } from "./dictionaries";
import { en, type MessageKey } from "./en";
import { format } from "./index";

const keys = Object.keys(en) as MessageKey[];
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

// Words that would claim a decision only the study team can make (see safety.md).
const FORBIDDEN: Record<string, RegExp> = {
  en: /eligib|qualif/i,
  es: /elegib|califica|cualifica/i,
  pt: /eleg[ií]ve|qualifica/i,
  ht: /elijib|kalifye/i,
  zh: /资格|合格/,
  vi: /đủ điều kiện|hội đủ/i,
};

describe("dictionaries", () => {
  it.each(LANGS.filter((l) => l !== "en"))("%s has every key", (lang) => {
    const missing = keys.filter((k) => !dictionaries[lang][k]);
    expect(missing).toEqual([]);
  });

  it.each(LANGS.filter((l) => l !== "en"))("%s keeps every {placeholder}", (lang) => {
    for (const k of keys) {
      const s = dictionaries[lang][k];
      if (s) expect(placeholders(s), `${lang} ${k}`).toEqual(placeholders(en[k]));
    }
  });

  it.each([...LANGS])("%s never claims eligibility", (lang) => {
    const strings = lang === "en" ? Object.values(en) : Object.values(dictionaries[lang]);
    for (const s of strings) expect(s).not.toMatch(FORBIDDEN[lang]);
  });

  it("has no unknown keys", () => {
    for (const lang of LANGS) {
      for (const k of Object.keys(dictionaries[lang])) expect(keys).toContain(k);
    }
  });
});

describe("format", () => {
  it("fills known placeholders and leaves unknown ones visible", () => {
    expect(format("{n} studies within {mi} miles", { n: 2, mi: 10 })).toBe("2 studies within 10 miles");
    expect(format("Call {phone}", {})).toBe("Call {phone}");
  });
});
