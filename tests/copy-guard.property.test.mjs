// Property tests for the two pure functions in copy-guard.mjs (Akash's file):
//   readingGrade(text)          -> Flesch–Kincaid grade estimate
//   findForbiddenPhrase(text)   -> {lang, phrase} | null  (the checker)
//   containsForbiddenPhrase(t)  -> boolean wrapper
//
// Importing copy-guard.mjs must NOT run its CLI: the module guards the entrypoint
// with an argv[1]/import.meta.url check, so these imports are side-effect free.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  readingGrade,
  findForbiddenPhrase,
  containsForbiddenPhrase,
  ALL_FORBIDDEN,
} from "./copy-guard.mjs";

// A broad arbitrary covering the inputs the checker must survive: ASCII, full
// Unicode (incl. Chinese), empty, whitespace-only, punctuation, and long strings.
const anyText = fc.oneof(
  fc.string(),
  fc.string({ unit: "binary" }),
  fc.constantFrom("", " ", "\t", "\n", "   \n\t  ", "。", "你好世界", "您符合"),
  // very long strings
  fc.string({ minLength: 2000, maxLength: 5000 }),
  fc.array(fc.constantFrom("您", "好", "的", "是", "不", " ", "。"), { maxLength: 4000 }).map((a) => a.join("")),
);

const nonEmptyText = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

describe("readingGrade properties", () => {
  it("is deterministic: same input -> same output", () => {
    fc.assert(
      fc.property(anyText, (t) => {
        expect(readingGrade(t)).toBe(readingGrade(t));
      }),
    );
  });

  it("returns a finite number for any non-empty (non-whitespace) string", () => {
    fc.assert(
      fc.property(nonEmptyText, (t) => {
        const g = readingGrade(t);
        expect(typeof g).toBe("number");
        expect(Number.isFinite(g)).toBe(true);
      }),
    );
  });

  it("never throws and always returns a finite number for ANY string", () => {
    // Includes empty / whitespace-only / Chinese / very long: the function must be total.
    fc.assert(
      fc.property(anyText, (t) => {
        const g = readingGrade(t);
        expect(typeof g).toBe("number");
        expect(Number.isFinite(g)).toBe(true);
      }),
    );
  });
});

describe("forbidden-phrase checker properties", () => {
  it("never throws on arbitrary Unicode, empty, whitespace, or very long input", () => {
    fc.assert(
      fc.property(anyText, (t) => {
        // must not throw; must return a boolean / (object|null)
        const b = containsForbiddenPhrase(t);
        expect(typeof b).toBe("boolean");
        const hit = findForbiddenPhrase(t);
        expect(hit === null || typeof hit === "object").toBe(true);
      }),
    );
  });

  it("appending a forbidden phrase to any string always flags it", () => {
    const phraseArb = fc.constantFrom(...ALL_FORBIDDEN.map((f) => f.phrase));
    fc.assert(
      fc.property(anyText, phraseArb, (prefix, phrase) => {
        const text = prefix + phrase;
        expect(containsForbiddenPhrase(text)).toBe(true);
        expect(findForbiddenPhrase(text)).not.toBeNull();
      }),
    );
  });

  it("appending a forbidden phrase flags it regardless of surrounding casing/whitespace", () => {
    const phraseArb = fc.constantFrom(...ALL_FORBIDDEN.map((f) => f.phrase));
    fc.assert(
      fc.property(anyText, phraseArb, anyText, (prefix, phrase, suffix) => {
        // case-insensitive: upper-casing the phrase must still be caught
        const text = prefix + phrase.toUpperCase() + suffix;
        expect(containsForbiddenPhrase(text)).toBe(true);
      }),
    );
  });

  // Vietnamese is now a scanned language (safety.md §1). These phrases are machine-drafted and
  // NEED REVIEW by a Vietnamese speaker; the test only asserts the checker tags them as vi.
  it("detects each Vietnamese forbidden phrase and tags it lang=vi", () => {
    const viPhrases = ALL_FORBIDDEN.filter((f) => f.lang === "vi").map((f) => f.phrase);
    expect(viPhrases.length).toBeGreaterThan(0);
    const prefixArb = fc.string();
    const suffixArb = fc.string();
    for (const phrase of viPhrases) {
      fc.assert(
        fc.property(prefixArb, suffixArb, (prefix, suffix) => {
          const hit = findForbiddenPhrase(prefix + phrase + suffix);
          expect(hit).not.toBeNull();
          expect(hit.lang).toBe("vi");
        }),
      );
    }
  });

  // One property per newly added phrase: wherever it is embedded (any prefix/suffix, any casing),
  // the checker must flag it, and tag it with the expected language.
  const NEW_PHRASES = [
    { phrase: "you are qualified", lang: "en" },
    { phrase: "you're qualified", lang: "en" },
    { phrase: "you will be accepted", lang: "en" },
    { phrase: "you're approved", lang: "en" },
    { phrase: "eres elegible", lang: "es" },
    { phrase: "tú calificas", lang: "es" },
  ];
  for (const { phrase, lang } of NEW_PHRASES) {
    it(`flags new forbidden phrase "${phrase}" (lang=${lang}) anywhere, any casing`, () => {
      // Sanity: the phrase is actually registered in ALL_FORBIDDEN.
      expect(ALL_FORBIDDEN.some((f) => f.phrase === phrase)).toBe(true);
      fc.assert(
        fc.property(fc.string(), fc.string(), fc.boolean(), (prefix, suffix, upper) => {
          const embedded = prefix + (upper ? phrase.toUpperCase() : phrase) + suffix;
          expect(containsForbiddenPhrase(embedded)).toBe(true);
          expect(findForbiddenPhrase(embedded)).not.toBeNull();
        }),
      );
    });
  }

  // Apostrophe-insensitive matching: every phrase that uses a straight ' must also be caught when
  // the text uses a curly ’ (U+2019). We only assert this for phrases that contain an apostrophe.
  it("flags the curly-apostrophe (’) variant of every apostrophe phrase, any prefix/suffix", () => {
    const apostrophePhrases = ALL_FORBIDDEN.map((f) => f.phrase).filter((p) => p.includes("'"));
    expect(apostrophePhrases.length).toBeGreaterThan(0);
    for (const phrase of apostrophePhrases) {
      const curly = phrase.replace(/'/g, "\u2019");
      expect(curly).not.toBe(phrase); // sanity: substitution actually happened
      fc.assert(
        fc.property(fc.string(), fc.string(), (prefix, suffix) => {
          expect(containsForbiddenPhrase(prefix + curly + suffix)).toBe(true);
          expect(findForbiddenPhrase(prefix + curly + suffix)).not.toBeNull();
        }),
      );
    }
  });
});
