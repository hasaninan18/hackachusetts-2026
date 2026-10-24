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
//   * with no generated questions the outcome is never "possible-fit" (cautious
//     fallback, docs/TASKS.md + fit-check Requirement 7): "insufficient-info" when the
//     text has no letter and no digit, "unchecked-criteria" when it has rules that
//     were not turned into questions; any generated question adds neither; it never
//     throws on malformed text.
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
          // No questions also adds a missing-info reason now, so check the age one directly.
          expect(r.reasons.some((x) => x.kind === (below ? "age-too-young" : "age-too-old"))).toBe(true);
        },
      ),
    );
  });

  // Cautious fallback: fit-check Requirement 7, widened by docs/TASKS.md (Hasan, 14:18) and
  // fixed in lib/quickCheck.ts by PR #16. With NO generated questions the structured checks
  // alone never give "possible-fit", and exactly one info reason says why:
  //   * no usable criteria text (empty, whitespace- or symbols-only)    -> "insufficient-info"
  //   * criteria text present, but no questions were made from it (simplify failed, timed out,
  //     is not deployed, or returned none), including the raw registry text the trial page
  //     passes in. Present text must not read as if the checklist checked it -> "unchecked-criteria"
  // Real structured mismatches (age / sex / healthy volunteer) are still reported next to it.

  // Both branches' versions of this property, combined: it still guards against crashes on
  // free-form junk (akash/kiro), and now asserts the cautious outcome and reason (PR #16).
  it("empty or malformed eligibility text never throws, and with no questions is never possible-fit", () => {
    const junkArb = fc.oneof(
      fc.constant(""),
      fc.constantFrom(" ", "\n\t ", "--- / . , ; ***"), // whitespace- and symbols-only
      fc.string(),
      fc.string({ unit: "binary" }),
    );
    fc.assert(
      fc.property(junkArb, (junk) => {
        const e: Eligibility = {
          minAgeYears: null,
          maxAgeYears: null,
          sex: "ALL",
          healthyVolunteers: true,
          criteriaText: junk,
        };
        const r = quickCheck({}, e, [], {});
        expect(r.outcome).toBe("ask-team");
        const kind = /[\p{L}\p{N}]/u.test(junk) ? "unchecked-criteria" : "insufficient-info";
        expect(r.reasons).toEqual([{ kind }]);
      }),
    );
  });

  // Was `it.fails` on akash/kiro: the Req 7 gap on the old lib/quickCheck.ts (counterexample
  // "--- / . , ; ***" gave "possible-fit"). PR #16 fixes that, so it is now a normal test.
  it("Req 7: empty/letterless criteria with no questions is ask-team with insufficient-info", () => {
    const emptyish = fc.oneof(
      fc.constant(""),
      fc.constant("   \n\t "),
      fc.constant("--- / . , ; ***"),
      // strings that, after trimming, contain no letters and no digits
      fc.string({ unit: "binary" }).filter((s) => !/[\p{L}\p{N}]/u.test(s)),
    );
    fc.assert(
      fc.property(emptyish, (criteriaText) => {
        const e: Eligibility = {
          minAgeYears: null,
          maxAgeYears: null,
          sex: "ALL",
          healthyVolunteers: true,
          criteriaText,
        };
        const r = quickCheck({}, e, [], {});
        expect(r.outcome).toBe("ask-team");
        expect(r.reasons).toEqual([{ kind: "insufficient-info" }]);
      }),
    );
  });

  // Hasan's PR #16 repro as a property: each demo trial's real registry criteria, no generated
  // questions, and a profile that passes every structured check (age in range, a sex the study
  // takes, has the condition). The old code said "possible-fit" here.
  it("criteria text with no generated questions is ask-team with unchecked-criteria, even real registry text", () => {
    const passingArb = fc.constantFrom(...mockTrials).chain((t) => {
      const { minAgeYears, maxAgeYears, sex } = t.eligibility;
      return fc.record({
        eligibility: fc.constant(t.eligibility),
        profile: fc.record(
          {
            age: fc.integer({ min: minAgeYears ?? 0, max: maxAgeYears ?? 120 }),
            sex: sex === "ALL" ? fc.constantFrom("FEMALE", "MALE" as const) : fc.constant(sex),
            healthy: fc.constant(false),
          },
          { requiredKeys: [] },
        ),
      });
    });
    fc.assert(
      fc.property(passingArb, ({ eligibility, profile }) => {
        const r = quickCheck(profile, eligibility, [], {});
        expect(r.outcome).toBe("ask-team");
        expect(r.reasons).toEqual([{ kind: "unchecked-criteria" }]);
      }),
    );
    // Any other text with a letter or digit, in any script, takes the same path.
    fc.assert(
      fc.property(
        fc.string().filter((s) => /[\p{L}\p{N}]/u.test(s)),
        (criteriaText) => {
          const e: Eligibility = {
            minAgeYears: null,
            maxAgeYears: null,
            sex: "ALL",
            healthyVolunteers: true,
            criteriaText,
          };
          expect(quickCheck({}, e, [], {})).toEqual({
            outcome: "ask-team",
            reasons: [{ kind: "unchecked-criteria" }],
          });
        },
      ),
    );
  });

  it("with no generated questions, every structured mismatch reason is kept next to the info reason", () => {
    // One question answered "not sure" can't rule anyone out and removes the info reason, so
    // its reasons are exactly the structured ones (age / sex / healthy volunteer).
    const probe: FitQuestion[] = [{ id: "probe", text: "Any other rule?", ruleOutIf: "yes" }];
    fc.assert(
      fc.property(profileArb, eligibilityArb, (p, e) => {
        const structured = quickCheck(p, e, probe, { probe: "unsure" }).reasons;
        const kind = /[\p{L}\p{N}]/u.test(e.criteriaText) ? "unchecked-criteria" : "insufficient-info";
        const r = quickCheck(p, e, [], {});
        expect(r.outcome).toBe("ask-team");
        expect(r.reasons).toEqual([...structured, { kind }]);
      }),
    );
  });

  it("any generated question means neither missing-info reason fires", () => {
    fc.assert(
      fc.property(
        eligibilityArb,
        questionsArb.filter((qs) => qs.length > 0),
        (e, qs) => {
          const r = quickCheck({}, e, qs, answersFor(qs, "unsure"));
          expect(r.reasons.filter((x) => x.kind === "insufficient-info" || x.kind === "unchecked-criteria")).toEqual([]);
        },
      ),
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
  // Vietnamese equivalents (safety.md §1). NEEDS REVIEW by a Vietnamese speaker —
  // machine-drafted, not verified. Added before vi ships so the scan covers vi copy too.
  vi: [
    "bạn đủ điều kiện",
    "bạn đủ tiêu chuẩn",
    "bạn phù hợp",
    "bạn đáp ứng các tiêu chí",
    "được bảo đảm",
  ],
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
