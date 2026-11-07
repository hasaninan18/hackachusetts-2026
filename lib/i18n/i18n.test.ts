import { describe, expect, it } from "vitest";
import { LANGS } from "../types";
import { dictionaries } from "./dictionaries";
import { en, type MessageKey } from "./en";
import { format } from "./index";
import { findForbiddenPhrase } from "../../tests/copy-guard.mjs";

const keys = Object.keys(en) as MessageKey[];
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

// Two layers. (1) Broad word stems per language, stricter than phrases (any "eligib…" etc.).
// (2) The exact safety.md §1 phrase list, imported from tests/copy-guard.mjs so the hook, the
// safety property test and this file share one list. The disclaimer is exempt from both: §4 fixes
// its wording ("The study team decides eligibility") and it is the one place the concept may appear.
const FORBIDDEN: Record<string, RegExp> = {
  en: /eligib|qualif|you're a match|meet the criteria|guaranteed|accepted|approved for/i,
  es: /elegib|califica|cualifica|cumple (con )?los requisitos/i,
  pt: /eleg[ií]ve|qualifica|atende aos crit[ée]rios/i,
  ht: /elijib|kalifye/i,
  zh: /资格|合格|符合条件/,
  vi: /đủ điều kiện|hội đủ/i,
};
const EXEMPT: MessageKey[] = ["disclaimer"];

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
    const dict: Partial<Record<MessageKey, string>> = lang === "en" ? en : dictionaries[lang];
    for (const [k, s] of Object.entries(dict) as [MessageKey, string][]) {
      if (!EXEMPT.includes(k)) expect(s, `${lang} ${k}`).not.toMatch(FORBIDDEN[lang]);
    }
  });

  it.each([...LANGS])("%s contains no safety.md phrase from the shared copy-guard list", (lang) => {
    const dict: Partial<Record<MessageKey, string>> = lang === "en" ? en : dictionaries[lang];
    for (const [k, s] of Object.entries(dict) as [MessageKey, string][]) {
      if (!EXEMPT.includes(k)) expect(findForbiddenPhrase(s), `${lang} ${k}`).toBeNull();
    }
  });

  it("the disclaimer is exactly the safety.md §4 text", () => {
    expect(en.disclaimer).toBe("TrialPath is not medical advice. The study team decides eligibility.");
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
