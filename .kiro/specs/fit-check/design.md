# Design — fit-check

## Overview

The fit-check turns one trial's eligibility data into a plain-language self-assessment that ends in
one of two outcomes — `possible-fit` or `ask-team` — and never claims the person is eligible. It
has two layers:

- **Pure decision core** (`lib/quickCheck.ts`): given a `Profile`, the trial's `Eligibility`, the
  generated `FitQuestion[]`, and the person's `answers`, it returns a `FitResult`
  (`{ outcome, reasons }`). No I/O, no clock, no randomness — trivially testable.
- **Client UI** (`components/QuickCheck.tsx` + `components/FitResult.tsx`): collects age / sex /
  healthy-volunteer and per-question answers, holds everything in React state only, gates the
  result until every on-screen group is answered, renders the outcome, and announces changes to
  assistive technology.

This design documents the feature as it exists today, maps each requirement to where it is
satisfied, and specifies the **one behavioral change** this spec introduces (Requirement 7) in a
dedicated "Proposed change for the owner" section. That change is in Neil-owned files
(`lib/`, `components/`, `lib/i18n/`) and is **not applied here** — it is a ready-to-lift proposal
for the PR.

## Architecture

```
Trial detail (API)                      Person (browser only)
  eligibility: Eligibility                age / sex / healthy / answers
  simplified.questions: FitQuestion[]            |
        |                                        |
        v                                        v
  components/QuickCheck.tsx  ---- builds Profile + answers (React state) ----+
        |  (renders groups, gates result, announces)                        |
        v                                                                    v
  lib/quickCheck.ts  quickCheck(profile, eligibility, questions, answers) -> FitResult
        |
        v
  components/FitResult.tsx  (renders outcome + reasons; amber for ask-team, never red)
```

Data boundaries (safety.md §3): the only thing that leaves the device is the **trial lookup** that
fetches `eligibility` and the generated `questions`. The person's age, sex, healthy answer, and
question answers live in `QuickCheck.tsx` React state and are never sent, stored, or logged.

## Components and contracts

### `lib/quickCheck.ts` (pure core — today)

```ts
export type Answer = "yes" | "no" | "unsure";
export interface Profile { age?: number; sex?: "FEMALE" | "MALE"; healthy?: boolean; }
export type FitOutcome = "possible-fit" | "ask-team";
export interface FitReason {
  kind: "age-too-young" | "age-too-old" | "sex" | "healthy-volunteer" | "answer";
  questionId?: string;
}
export interface FitResult { outcome: FitOutcome; reasons: FitReason[]; }
export function quickCheck(profile, eligibility, questions, answers): FitResult
```

Rules it enforces today (and the design keeps): inclusive age bounds; `null` bound = open; sex
only when `sex !== "ALL"`; healthy-volunteer only when `healthyVolunteers === false`; an answer
equal to a question's `ruleOutIf` records an `answer` reason; missing fields and `"unsure"` never
rule anyone out; `outcome = reasons.length ? "ask-team" : "possible-fit"`.

### `components/QuickCheck.tsx` (client UI — today)

- Age: numeric-only, max 3 digits, debounced ~800ms so a partial value never flashes a result;
  validated to a whole number 0–120 via a local `parseAge` (returns `undefined` otherwise).
- Sex group shown only when `eligibility.sex !== "ALL"`; healthy group only when
  `eligibility.healthyVolunteers === false`.
- Question answers keyed by a `questionSet` signature (`id + text` joined); if the question set
  changes, prior answers are dropped (Req 3.6).
- Result gating: shown only when `status !== "loading"` and either every visible group is answered
  or (no groups) a valid age exists (Req 9).
- A single `role="status"` live region announces outcome/reason-count changes, with a flip space so
  a reasons-only change is still announced (Req 9.4).
- Print view lists chosen answers for the doctor; radios are `no-print`.

### `components/FitResult.tsx` (presentational — today)

- `possible-fit` → `fit-bg` panel, title `fit.possibleTitle`, body `fit.possibleBody`.
- `ask-team` → amber (`ask-bg`), title `fit.askTitle`, body `fit.askBody`, plus a `<ul>` of reason
  text. Never red (a caution, not a failure).
- `reasonText` switches on `reason.kind`; the `answer` case renders the question text in its own
  `lang` element, inserting it at the `{q}` marker in the i18n template.

## Requirements traceability

| Req | Where satisfied | Notes |
|-----|-----------------|-------|
| 1 Structured checks | `lib/quickCheck.ts` age/sex/healthy branches | inclusive bounds; null = open |
| 2 Age input | `QuickCheck.tsx` `parseAge`, debounce, `fit.ageError` | 0–120 whole number only |
| 3 Generated questions | `QuickCheck.tsx` question groups; `ruleOutIf` match in core | question-set reset on change |
| 4 Source criterion beside question | **new** — see "Source criterion display" | additive optional field |
| 5 Two outcomes | `lib/quickCheck.ts` `FitOutcome`; `FitResult.tsx` | exactly possible-fit / ask-team |
| 6 Never claim eligibility | safety.md copy in `en.ts`; copy-guard hook | ≤8th grade; forbidden phrases |
| 7 Empty/question-less → ask-team | **changes core** — see "Proposed change for the owner" | distinct reason |
| 8 Answers in browser | `QuickCheck.tsx` React state only | no fetch/storage of answers |
| 9 Gating & progress | `QuickCheck.tsx` `showResult`, `fit.progress`, live region | "not sure" counts as answered |
| 10 Contact + disclaimer | trial detail view (surrounds fit-check) | verbatim §4 disclaimer |

## Source criterion display (Requirement 4)

Today `FitQuestion` is `{ id, text, ruleOutIf }` and the UI renders only `q.text`. To show the
original criterion beside each question without touching the decision logic, add an **optional**
field, e.g. `sourceCriterion?: string`, to `FitQuestion` in `lib/types.ts`. `quickCheck` ignores
it (it only reads `id` and `ruleOutIf`), so the core contract and all existing tests are
unaffected. `QuickCheck.tsx` renders `q.sourceCriterion` under the question when present, verbatim
(safety.md §5 — never alter NCT/phone/email) and in the source language when it differs from the
UI language. This is additive and owned by Neil, but it is NOT the behavioral safety change below.

## Error, empty, and loading states

- Questions loading → skeletons with `aria-busy`, no result (Req 3.4).
- No questions produced → today shows `fit.noQuestions` ("more rules — ask the study team").
  Under the proposed change, that same message pairs with an `ask-team` outcome (Req 7).
- Invalid age → `fit.ageError`, age treated as not-answered (Req 2.2).
- Arbitrary/garbage criteria → core never throws; UI shows the questionless message (Req 7.6).

---

## Proposed change for the owner (Requirement 7) — NOT applied here

> **Ownership:** `lib/quickCheck.ts`, `components/FitResult.tsx`, and `lib/i18n/en.ts` are Neil's
> (structure.md). This section is a ready-to-lift proposal for the PR; nothing in `lib/` or
> `components/` is edited by this spec. The accompanying test is co-located per structure.md
> (`lib/quickCheck.test.ts`).

### Problem

`quickCheck` returns `possible-fit` whenever `reasons.length === 0`. That collapses two different
situations:

- **A** — the person answered everything and nothing ruled them out → should stay `possible-fit`.
- **B** — the eligibility text was empty/whitespace-only and produced **no questions** → should be
  `ask-team` (safety.md: absence of info is not reassurance).

`reasons.length` alone can't tell A from B, so the fix adds a distinct reason that fires only in
case B. "No questions" is the signal we can trust: if `questions.length > 0`, the criteria yielded
questions, so B does not apply (Req 7.4).

**Narrow scope — exactly when it fires.** The insufficient-info reason fires only when BOTH:
(a) `questions.length === 0`, AND (b) `criteriaText` is empty/malformed, defined as **no letters
and no digits after trimming** (empty, whitespace-only, or symbols/punctuation-only). Any
`criteriaText` containing at least one letter or digit — even if no questions were generated from
it — does NOT trigger it; that case keeps the structured result plus the existing `fit.noQuestions`
message (Req 7.5).

**Preserves the tech.md LLM-failure fallback.** tech.md's last-resort fallback is "structured
quick-check only"; structure.md's LLM-failure state skips the generated questions. In that mode
`questions.length === 0`, but the API's `criteriaText` is still present (letters/digits intact), so
condition (b) is false and insufficient-info does NOT fire. The structured age/sex/healthy checks
produce their normal outcome, exactly as the fallback intends. This is why the branch tests the
text content, not just `questions.length`.

### Change 1 — `FitReason.kind` gains `"insufficient-info"`

```diff
 export interface FitReason {
-  kind: "age-too-young" | "age-too-old" | "sex" | "healthy-volunteer" | "answer";
+  kind: "age-too-young" | "age-too-old" | "sex" | "healthy-volunteer" | "answer" | "insufficient-info";
   questionId?: string;
 }
```

### Change 2 — `lib/quickCheck.ts` records it when criteria are empty AND no questions exist

```diff
   for (const q of questions) {
     if (answers[q.id] === q.ruleOutIf) reasons.push({ kind: "answer", questionId: q.id });
   }
+  // Safety: eligibility text with no letters and no digits (empty, whitespace-only, or
+  // symbols-only) that produced no questions is an absence of information, not a fit.
+  // Narrowly scoped: if there is any question, OR the text has a letter/digit, this is skipped —
+  // so the tech.md LLM-failure fallback (structured checks only, criteriaText still present) is
+  // unaffected.
+  const hasContent = /[\p{L}\p{N}]/u.test(eligibility.criteriaText);
+  if (questions.length === 0 && !hasContent) {
+    reasons.push({ kind: "insufficient-info" });
+  }
   return { outcome: reasons.length ? "ask-team" : "possible-fit", reasons };
```

Note: this keeps the existing `outcome = reasons.length ? "ask-team" : "possible-fit"` line
unchanged — the new reason flows through it naturally. Case A (questions answered, nothing ruled
out) is untouched because `questions.length > 0` there. The `\p{L}`/`\p{N}` test treats any
letter (incl. non-Latin scripts) or digit as real content, so only truly empty/symbols-only text
counts as malformed.

### Change 3 — `components/FitResult.tsx` renders the new reason

Add a case to the `reasonText` switch:

```diff
     case "healthy-volunteer":
       return t("fit.reason.healthy-volunteer");
+    case "insufficient-info":
+      return t("fit.reason.insufficient-info");
     case "answer": {
```

### Change 4 — `lib/i18n/en.ts` gets one new key (≤ 8th-grade, no forbidden phrases)

```diff
   "fit.reason.healthy-volunteer": "The study is for people who have the condition.",
+  "fit.reason.insufficient-info": "This study did not share enough about who can join. Ask the study team.",
   "fit.reason.answer": "You answered \"{a}\" to: {q}",
```

> The non-English dictionaries mirror these keys; per safety.md the new key's translations (and
> any forbidden-phrase equivalents, though this copy has none) must be added before each language
> ships. The copy-guard hook should be run on the new string.

### Change 5 — test (co-located in `lib/quickCheck.test.ts`)

```ts
describe("insufficient-info (empty criteria, no questions) -> ask-team", () => {
  const empty: Eligibility = {
    minAgeYears: null, maxAgeYears: null, sex: "ALL",
    healthyVolunteers: true, criteriaText: "",
  };

  it("empty criteria with no questions is ask-team, not possible-fit", () => {
    const r = quickCheck({}, empty, [], {});
    expect(r.outcome).toBe("ask-team");
    expect(r.reasons).toEqual([{ kind: "insufficient-info" }]);
  });

  it("whitespace-only criteria with no questions is ask-team", () => {
    const r = quickCheck({}, { ...empty, criteriaText: "   \n\t " }, [], {});
    expect(r.outcome).toBe("ask-team");
    expect(r.reasons.some((x) => x.kind === "insufficient-info")).toBe(true);
  });

  it("symbols/punctuation-only criteria with no questions is ask-team", () => {
    // No letters and no digits -> treated as malformed / absence of info.
    const r = quickCheck({}, { ...empty, criteriaText: "--- / . , ; ***" }, [], {});
    expect(r.outcome).toBe("ask-team");
    expect(r.reasons.some((x) => x.kind === "insufficient-info")).toBe(true);
  });

  it("does NOT fire when there is at least one question (case A stays possible-fit)", () => {
    const qs: FitQuestion[] = [{ id: "q1", text: "…", ruleOutIf: "no" }];
    const r = quickCheck({}, empty, qs, { q1: "yes" });
    expect(r.outcome).toBe("possible-fit");
    expect(r.reasons).toEqual([]);
  });

  it("does NOT fire when criteria text has letters/digits even if no questions were generated", () => {
    // Non-empty text (a letter or digit) with no questions is NOT an absence of info; the text is
    // still shown. This is also the tech.md LLM-failure fallback path (structured checks only,
    // criteriaText present) — it must keep its structured result, not become insufficient-info.
    const r = quickCheck({}, { ...empty, criteriaText: "Must be 18 or older." }, [], {});
    expect(r.reasons.some((x) => x.kind === "insufficient-info")).toBe(false);
    expect(r.outcome).toBe("possible-fit"); // nothing ruled out, text present
  });
});
```

### Property-test impact (cross-cutting, Akash-owned `tests/`)

`tests/safety.property.test.ts` currently asserts "empty/malformed eligibility text with no
questions and empty profile → `possible-fit`". After this change that specific assertion flips: the
property becomes **`questions.length === 0 && criteriaText has no letter or digit → ask-team` with
an `insufficient-info` reason**, while a `criteriaText` containing any letter/digit, or any
generated question, keeps the existing behavior. That property update lands together with the PR so
the suite stays green.

### Blast radius summary

| File | Owner | Change |
|------|-------|--------|
| `lib/quickCheck.ts` | Neil | +1 reason kind, guarded branch (content + no-questions check) |
| `components/FitResult.tsx` | Neil | +1 switch case |
| `lib/i18n/en.ts` (+ other dicts) | Neil | +1 key (and its translations before ship) |
| `lib/quickCheck.test.ts` | Neil | +5 cases (empty, whitespace, symbols-only, has-question, has-content) |
| `tests/safety.property.test.ts` | Akash | flip one property to the new contract |

No change to `QuickCheck.tsx` gating is required: it already shows `fit.noQuestions` when
`questions.length === 0`, so the message and the `ask-team` outcome line up once the core change
lands.

## Design decisions and rationale

- **Why a distinct reason instead of flipping the outcome rule?** The outcome line
  (`reasons.length ? "ask-team" : "possible-fit"`) is correct and is relied on by every existing
  test. The real defect is that case B produces zero reasons; giving it a reason fixes the defect
  at its source and keeps case A (`possible-fit`) intact.
- **Why gate on `questions.length === 0` AND content-free text, not either alone?** "No questions"
  plus text that has no letter or digit is the unambiguous absence-of-info case. If the API
  supplied criteria text with any real content (even without generated questions), the text is
  still shown to the person, so it is not treated as an absence of info — this keeps the branch
  narrow and avoids surprising `ask-team` results for trials that simply didn't auto-generate
  questions.
- **Why this preserves the LLM-failure fallback (tech.md).** The fallback runs structured checks
  only and skips questions, so `questions.length === 0` — but the trial's `criteriaText` is still
  present (letters intact), so the content test is true and insufficient-info does not fire. Had
  the branch keyed on `questions.length` alone, the fallback would wrongly flip every trial to
  `ask-team` during an LLM outage. Keying on text content is what keeps the fallback intact.
- **Why keep it owner-authored?** Respecting the structure.md ownership map (the same reason the
  `results.tryWider` reading-grade finding was flagged to Neil rather than edited) keeps the
  Kiro-workflow history clean and avoids cross-owner merge conflicts.
