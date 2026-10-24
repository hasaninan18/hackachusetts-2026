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

  it("appending a forbidden phrase flags it (any casing) and tags its language", () => {
    const entryArb = fc.constantFrom(...ALL_FORBIDDEN);
    fc.assert(
      fc.property(anyText, entryArb, anyText, (prefix, { lang, phrase }, suffix) => {
        // case-insensitive: upper-casing the phrase must still be caught
        const hit = findForbiddenPhrase(prefix + phrase.toUpperCase() + suffix);
        expect(hit).not.toBeNull();
        expect(containsForbiddenPhrase(prefix + phrase + suffix)).toBe(true);
        // the language tag is only well-defined when the padding contains no other phrase
        if (!findForbiddenPhrase(prefix) && !findForbiddenPhrase(suffix)) expect(hit.lang).toBe(lang);
      }),
    );
  });

  it("flags a forbidden phrase in either Unicode form (NFC or NFD)", () => {
    const entryArb = fc.constantFrom(...ALL_FORBIDDEN);
    const formArb = fc.constantFrom("NFC", "NFD");
    fc.assert(
      fc.property(fc.string(), entryArb, formArb, (prefix, { phrase }, form) => {
        expect(findForbiddenPhrase((prefix + " " + phrase).normalize(form))).not.toBeNull();
      }),
    );
  });

  // Fixed examples written independently of the list, so a missing or mistyped phrase fails
  // (a property drawn from ALL_FORBIDDEN can only re-check what's already in it).
  // Vietnamese examples are machine-drafted and NEED REVIEW by a Vietnamese speaker.
  it.each([
    ["Bạn đủ điều kiện tham gia.", "vi"],
    ["Bạn có đủ điều kiện tham gia nghiên cứu này.", "vi"],
    ["Bạn hội đủ điều kiện", "vi"],
    ["Kết quả được đảm bảo.", "vi"],
    ["Kết quả được bảo đảm.", "vi"],
    ["Great news: you're eligible!", "en"],
    ["Usted califica para este estudio.", "es"],
    ["Você é elegível.", "pt"],
    ["Ou kalifye pou etid sa a.", "ht"],
    ["您符合条件。", "zh"],
  ])("catches %j as %s", (text, lang) => {
    expect(findForbiddenPhrase(text)?.lang).toBe(lang);
    expect(findForbiddenPhrase(text.normalize("NFD"))?.lang).toBe(lang);
  });

  it.each([
    "Hãy đảm bảo bạn mang theo giấy tờ.", // "make sure you bring your papers": allowed
    "Nghiên cứu này có thể phù hợp với bạn.", // "may be a possible fit": allowed
    "Nhóm nghiên cứu quyết định ai có thể tham gia.", // the vi disclaimer
  ])("does not flag allowed Vietnamese copy %j", (text) => {
    expect(findForbiddenPhrase(text)).toBeNull();
  });
});
