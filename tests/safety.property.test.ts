// Cross-cutting property tests (Akash, tests/). These intentionally live OUTSIDE lib/,
// which is owned by others and already has co-located unit tests. Here we assert invariants
// that span modules + content fixtures: the geo primitive, the quick-check contract, and the
// safety.md forbidden-phrase rules applied to EVERY shipped i18n string and demo fixture.
//
// Scope note (what actually exists on origin/main under lib/):
//   - haversineMi  (not "haversine(a,b)")                              -> tested below
//   - quickCheck   (outcomes are "possible-fit" | "ask-team" only)     -> tested below
//   - parseAge          -> DOES NOT EXIST yet (age parsing is backend) -> NOT tested
//   - rankBySiteDistance-> DOES NOT EXIST (sort is inlined in an async  -> NOT tested
//                          server-only getTrials; nothing pure to test)
//   - readingGrade      -> DOES NOT EXIST yet                          -> NOT tested
// We only test what exists. See the chat summary / KIRO_LOG for the missing list.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { haversineMi } from "../lib/geo";
import { quickCheck, type Answer, type Profile } from "../lib/quickCheck";
import type { Eligibility, FitQuestion } from "../lib/types";

import { en } from "../lib/i18n/en";
import { dictionaries } from "../lib/i18n/dictionaries";
import { mockTrials } from "../lib/mock/data";

// simplified.ts holds the module-private fixture via a getter; pull the shipped strings out.
import { getMockSimplified } from "../lib/mock/simplified";
import { LANGS } from "../lib/types";

// ---------------------------------------------------------------------------
// haversineMi — a distance is symmetric, never negative, and zero for a point
// against itself. (lib/ is canonical MILES; this is the one geo primitive.)
// ---------------------------------------------------------------------------

const lat = fc.double({ min: -89.9, max: 89.9, noNaN: true });
const lon = fc.double({ min: -179.9, max: 179.9, noNaN: true });

describe("haversineMi properties", () => {
  it("is symmetric: h(a,b) === h(b,a)", () => {
    fc.assert(
      fc.property(lat, lon, lat, lon, (la1, lo1, la2, lo2) => {
        expect(haversineMi(la1, lo1, la2, lo2)).toBeCloseTo(haversineMi(la2, lo2, la1, lo1), 9);
      }),
    );
  });

  it("is non-negative everywhere", () => {
    fc.assert(
      fc.property(lat, lon, lat, lon, (la1, lo1, la2, lo2) => {
        expect(haversineMi(la1, lo1, la2, lo2)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("is zero for identical points", () => {
    fc.assert(
      fc.property(lat, lon, (la, lo) => {
        expect(haversineMi(la, lo, la, lo)).toBe(0);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// quickCheck — the cross-cutting safety contract. The real outcome type is
// "possible-fit" | "ask-team" (NOT the three-way may-rule-out/not-sure the old
// steering draft named). We test the true behavior:
//   * outcome is always one of the two allowed values;
//   * an age outside [min,max] always yields "ask-team" (the cautious outcome);
//   * empty / malformed eligibility text never, on its own, yields anything but
//     "possible-fit" from the text (there is no text rule that can rule you out),
//     i.e. garbage criteriaText can't manufacture a false "possible-fit" either —
//     with no reasons it stays "possible-fit", which is the safe "contact the team".
// ---------------------------------------------------------------------------

const ALLOWED_OUTCOMES = ["possible-fit", "ask-team"] as const;

const eligibilityArb: fc.Arbitrary<Eligibility> = fc
  .record({
    a: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    b: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    sex: fc.constantFrom("ALL", "FEMALE", "MALE" as const),
    healthyVolunteers: fc.boolean(),
    // deliberately throw junk, empty, and control chars at criteriaText
    criteriaText: fc.oneof(fc.constant(""), fc.string(), fc.string({ unit: "binary" })),
  })
  .map(({ a, b, sex, healthyVolunteers, criteriaText }) => ({
    minAgeYears: a !== null && b !== null ? Math.min(a, b) : a,
    maxAgeYears: a !== null && b !== null ? Math.max(a, b) : b,
    sex,
    healthyVolunteers,
    criteriaText,
  }));

const profileArb: fc.Arbitrary<Profile> = fc.record(
  {
    age: fc.integer({ min: 0, max: 120 }),
    sex: fc.constantFrom("FEMALE", "MALE" as const),
    healthy: fc.boolean(),
  },
  { requiredKeys: [] },
);

const questionsArb = fc.uniqueArray(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 4 }),
    text: fc.string(),
    ruleOutIf: fc.constantFrom("yes", "no" as const),
  }),
  { maxLength: 6, selector: (q: FitQuestion) => q.id },
);

const answersFor = (qs: FitQuestion[], pick: Answer) =>
  Object.fromEntries(qs.map((q) => [q.id, pick])) as Record<string, Answer>;

describe("quickCheck cross-cutting contract", () => {
  it("only ever returns an allowed outcome", () => {
    fc.assert(
      fc.property(
        profileArb,
        eligibilityArb,
        questionsArb,
        fc.array(fc.constantFrom<Answer>("yes", "no", "unsure"), { maxLength: 6 }),
        (p, e, qs, picks) => {
          const answers = Object.fromEntries(
            qs.map((q, i) => [q.id, picks[i] ?? "unsure"]),
          ) as Record<string, Answer>;
          const r = quickCheck(p, e, qs, answers);
          expect(ALLOWED_OUTCOMES).toContain(r.outcome);
        },
      ),
    );
  });

  it("an age outside the study's range always yields the cautious ask-team", () => {
    // Build an eligibility with a real finite window, then push the age outside it.
    const windowArb = fc
      .record({ lo: fc.integer({ min: 1, max: 98 }), span: fc.integer({ min: 1, max: 20 }) })
      .map(({ lo, span }) => ({ min: lo, max: lo + span }));

    fc.assert(
      fc.property(
        windowArb,
        fc.boolean(), // below vs above the window
        eligibilityArb,
        (win, below, base) => {
          const e: Eligibility = {
            ...base,
            minAgeYears: win.min,
            maxAgeYears: win.max,
          };
          const age = below ? win.min - 1 : win.max + 1;
          // No question answers and a profile that matches on sex/healthy so the ONLY
          // possible reason is the out-of-range age.
          const r = quickCheck({ age }, e, [], {});
          expect(r.outcome).toBe("ask-team");
        },
      ),
    );
  });

  it("empty or malformed eligibility text never fabricates a stricter-than-reasons outcome", () => {
    // criteriaText is free-form junk here; it has no rule attached, so with no other
    // disqualifier and no answers the outcome must be the safe default, never a crash.
    fc.assert(
      fc.property(fc.oneof(fc.constant(""), fc.string({ unit: "binary" })), (junk) => {
        const e: Eligibility = {
          minAgeYears: null,
          maxAgeYears: null,
          sex: "ALL",
          healthyVolunteers: true,
          criteriaText: junk,
        };
        const r = quickCheck({}, e, [], {});
        expect(ALLOWED_OUTCOMES).toContain(r.outcome);
        // nothing to rule out -> possible-fit (the "contact the team" safe outcome),
        // and crucially it never throws on malformed text.
        expect(r.outcome).toBe("possible-fit");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Forbidden-phrase scan — safety.md §1. No shipped i18n string or demo fixture
// may contain a forbidden phrase in ANY supported language, and none may use a
// bare "eligible"/"qualify" except the one mandated disclaimer (safety.md §4).
// We scan STRING VALUES from the real exports, so source comments can't trip it.
// ---------------------------------------------------------------------------

// Verbatim from .kiro/steering/safety.md §1, case-insensitive.
const FORBIDDEN_BY_LANG: Record<string, string[]> = {
  en: [
    "you are eligible",
    "you qualify",
    "you're a match",
    "you have been accepted",
    "you meet the criteria",
    "guaranteed",
    "approved for this trial",
  ],
  es: ["usted califica", "usted es elegible", "cumple los requisitos"],
  pt: ["você se qualifica", "você é elegível", "atende aos critérios"],
  ht: ["ou kalifye", "ou elijib"],
  zh: ["您符合条件", "您符合资格", "您合格"],
  // vi intentionally absent: safety.md says Vietnamese equivalents must be added
  // BEFORE Vietnamese ships. If vi strings appear, the "no bare eligible/qualify"
  // guard below still covers the Latin-script cases.
};

const ALL_FORBIDDEN = Object.values(FORBIDDEN_BY_LANG).flat();

// The single allowed use of "eligib*": the fixed disclaimer required by safety.md §4.
const MANDATED_DISCLAIMER = "TrialPath is not medical advice. The study team decides eligibility.";

/** Collect every user-facing STRING VALUE from an object/array, recursively. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

function shippedStrings(): string[] {
  const out: string[] = [];
  collectStrings(en, out);
  collectStrings(dictionaries, out); // currently all-empty; future translations land here
  collectStrings(mockTrials, out); // titles, summaries, criteria, contacts
  // every simplified fixture we actually ship, for every language we try to render
  for (const t of mockTrials) {
    for (const lang of LANGS) {
      const s = getMockSimplified(t.nctId, lang);
      if (s) collectStrings(s, out);
    }
  }
  return out;
}

describe("safety.md forbidden-phrase scan over shipped copy", () => {
  const strings = shippedStrings();

  it("has copy to scan (guards against a silently-empty pass)", () => {
    expect(strings.length).toBeGreaterThan(0);
  });

  it("contains no forbidden phrase in any supported language", () => {
    const offenders: Array<{ phrase: string; text: string }> = [];
    for (const text of strings) {
      const hay = text.toLowerCase();
      for (const phrase of ALL_FORBIDDEN) {
        if (hay.includes(phrase.toLowerCase())) offenders.push({ phrase, text });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses no bare 'eligible'/'qualify' outside the mandated disclaimer, unless negated", () => {
    // Allowed negations: "decides eligibility" (study team decides), "does not ... eligible",
    // "may rule you out", etc. We allow ONLY the exact mandated disclaimer sentence and any
    // string where the term is immediately preceded by a negation/"decides".
    const NEGATION = /(not|never|doesn['’]t|does not|cannot|can['’]t|decides?|rule(s)? (you )?out)\b/i;
    const RISK = /\b(eligib\w*|qualif\w*)\b/i;

    const offenders: string[] = [];
    for (const text of strings) {
      if (!RISK.test(text)) continue;
      if (text.includes(MANDATED_DISCLAIMER)) continue; // §4 verbatim, allowed
      // Look at each risky hit's local context for a negation cue.
      const re = new RegExp(RISK.source, "gi");
      let m: RegExpExecArray | null;
      let flagged = false;
      while ((m = re.exec(text)) !== null) {
        const start = Math.max(0, m.index - 40);
        const context = text.slice(start, m.index + m[0].length + 10);
        if (!NEGATION.test(context)) flagged = true;
      }
      if (flagged) offenders.push(text);
    }
    expect(offenders).toEqual([]);
  });
});
