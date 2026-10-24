# Requirements — fit-check

## Introduction

The fit-check feature lets a person decide whether a specific recruiting clinical trial is worth
contacting the study team about, without ever telling them they are eligible. For one trial, it
runs structured checks against the trial's API eligibility fields (age range, sex, healthy
volunteers) and presents simple yes / no / not-sure questions generated from the free-text
eligibility criteria, showing the original criterion text beside each question. It then reports
one of exactly two outcomes — **possible-fit** or **ask-team** — and never says a person is
eligible or qualifies. All of the person's answers stay in the browser.

This spec is grounded in the code that exists today:

- `lib/quickCheck.ts` — the pure decision function. Outcomes are the `FitOutcome` union
  `"possible-fit" | "ask-team"`; reasons use the `FitReason.kind` set
  `"age-too-young" | "age-too-old" | "sex" | "healthy-volunteer" | "answer"`.
- `lib/quickCheck.test.ts` — the behavioral contract already asserted (inclusive age bounds,
  healthy-volunteer gating, sex gating, answer rule-out, "not sure" / missing fields never rule
  anyone out, and the two-outcome invariant).
- `components/QuickCheck.tsx` — the client UI: age input, sex / healthy radio groups shown only
  when the trial requires them, per-question radio groups, answers held in React state only, the
  result gated until every on-screen group is answered.
- `components/FitResult.tsx` — renders the two outcomes (amber for ask-team, never red) and the
  per-reason explanation list.
- `.kiro/steering/safety.md` — the non-negotiable guardrails (§1 never claim eligibility and the
  forbidden-phrase list, §2 ≤ 8th-grade reading level, §3 health answers stay in the browser,
  §4 always show contact + disclaimer, §5 preserve identifiers verbatim, §6 scope boundaries).

Terminology used below:
- **Structured check** — a comparison against a typed API eligibility field (`minAgeYears`,
  `maxAgeYears`, `sex`, `healthyVolunteers`).
- **Generated question** — a `FitQuestion` (`{ id, text, ruleOutIf }`) derived from the free-text
  `criteriaText`, answered yes / no / not-sure.
- **Source criterion text** — the original free-text eligibility sentence a generated question was
  derived from, displayed beside that question.

> Note (existing-code gap): today's `FitQuestion` type carries `id`, `text`, and `ruleOutIf` only,
> and `QuickCheck.tsx` renders `q.text` without an adjacent source criterion. Requirement 4 adds
> the "show the original criterion beside the question" behavior, which implies an additive,
> optional field on the question (e.g. a source-criterion string) rather than a change to the
> decision logic in `lib/quickCheck.ts`.

---

## Requirement 1 — Structured checks from API fields

**User story:** As a person looking at a trial, I want the app to check my age, sex, and
healthy-volunteer status against the trial's stated eligibility fields, so that obvious
mismatches are surfaced before I contact the study team.

#### Acceptance Criteria

1. WHEN a trial's `eligibility.minAgeYears` is a number AND the person's entered age is below it,
   THEN the system SHALL record an `age-too-young` reason.
2. WHEN a trial's `eligibility.maxAgeYears` is a number AND the person's entered age is above it,
   THEN the system SHALL record an `age-too-old` reason.
3. WHEN the person's entered age is equal to `eligibility.minAgeYears` OR equal to
   `eligibility.maxAgeYears`, THEN the system SHALL NOT record an age reason (bounds are inclusive).
4. WHEN `eligibility.minAgeYears` is `null`, THEN the system SHALL treat the minimum age as open
   and SHALL NOT record `age-too-young`; WHEN `eligibility.maxAgeYears` is `null`, THEN the system
   SHALL treat the maximum age as open and SHALL NOT record `age-too-old`.
5. WHEN `eligibility.sex` is not `"ALL"` AND the person's selected sex differs from
   `eligibility.sex`, THEN the system SHALL record a `sex` reason.
6. WHEN `eligibility.sex` is `"ALL"`, THEN the system SHALL NOT ask for sex and SHALL NOT record a
   `sex` reason.
7. WHEN `eligibility.healthyVolunteers` is `false` AND the person indicates they do not have the
   trial's health condition (i.e. they are a healthy volunteer), THEN the system SHALL record a
   `healthy-volunteer` reason.
8. WHEN `eligibility.healthyVolunteers` is `true`, THEN the system SHALL NOT record a
   `healthy-volunteer` reason for any answer.
9. WHEN the person has not entered an age, OR has not selected a sex, OR has not answered the
   healthy-volunteer question, THEN the system SHALL NOT record a reason for that unanswered
   structured check (a missing answer never rules anyone out).

## Requirement 2 — Age input handling

**User story:** As a person entering my age, I want only a sensible whole-number age to count,
so that a typo or partial entry never produces a misleading result.

#### Acceptance Criteria

1. WHEN the person types an age, THEN the system SHALL accept only a whole number from 0 to 120 as
   a valid age.
2. IF the entered age is non-empty AND is not a whole number from 0 to 120, THEN the system SHALL
   treat the age as not answered AND SHALL show an age-input error message.
3. WHEN the age field is empty, THEN the system SHALL treat age as optional and SHALL NOT block the
   result on it.
4. WHILE the person is still typing an age, the system SHALL wait for a short pause before the
   typed value counts toward the result, so that an in-progress value does not momentarily change
   the outcome.

## Requirement 3 — Questions generated from free-text eligibility criteria

**User story:** As a person who cannot parse dense eligibility criteria, I want a few simple
yes / no / not-sure questions drawn from the trial's criteria text, so that I can self-assess in
plain language.

#### Acceptance Criteria

1. WHEN a trial's generated questions are available, THEN the system SHALL present each question as
   a single group offering exactly the three answers yes, no, and not-sure.
2. WHEN a generated question's `ruleOutIf` value matches the person's answer, THEN the system SHALL
   record an `answer` reason carrying that question's id.
3. WHEN the person answers a generated question "not sure", OR leaves it unanswered, THEN the
   system SHALL NOT record a reason for that question.
4. WHILE the generated questions are still loading, the system SHALL show a loading state with
   `aria-busy` and SHALL NOT show a result.
5. IF the generated questions are unavailable (none were produced), THEN the system SHALL show a
   plain-language message telling the person to ask the study team about the remaining rules, AND
   SHALL still allow the structured checks to produce a result.
6. WHEN the set of generated questions changes (any id or wording differs), THEN the system SHALL
   discard answers tied to the previous question set rather than reattaching them to new questions.

## Requirement 4 — Show the original criterion beside each question

**User story:** As a person answering a generated question, I want to see the trial's original
eligibility wording next to the question, so that I can trust the simplification and check it
against the source.

#### Acceptance Criteria

1. WHEN a generated question is derived from a specific free-text criterion, THEN the system SHALL
   display that original criterion text beside or beneath the simplified question.
2. WHEN the source criterion text is displayed, THEN the system SHALL present it verbatim and SHALL
   NOT alter, translate, or simplify any NCT id, phone number, or email it contains (safety.md §5).
3. IF a generated question has no associated source criterion text, THEN the system SHALL show the
   simplified question alone WITHOUT an empty or placeholder criterion element.
4. WHEN the simplified question is shown in a language different from the source criterion, THEN
   the system SHALL mark each text with its own language for assistive technology.

## Requirement 5 — Two outcomes only, matching `lib/quickCheck.ts`

**User story:** As a safety-conscious team, we want the result to be exactly one of the two
outcomes the decision function returns today, so that the UI can never imply an eligibility
decision.

#### Acceptance Criteria

1. WHEN the system produces a result, THEN the outcome SHALL be exactly one of `"possible-fit"` or
   `"ask-team"` and no other value.
2. WHEN one or more reasons have been recorded, THEN the outcome SHALL be `"ask-team"`.
3. WHEN no reason has been recorded, THEN the outcome SHALL be `"possible-fit"`.
4. WHEN the outcome is `"possible-fit"`, THEN the system SHALL present it as a possible fit that
   still requires contacting the study team, using the allowed plain-language copy.
5. WHEN the outcome is `"ask-team"`, THEN the system SHALL present it as "some answers may rule you
   out — ask the study team", styled as a caution (amber) and never as a failure (red), AND SHALL
   list the recorded reasons.
6. WHEN the outcome is `"ask-team"` because of an `answer` reason, THEN the system SHALL show which
   question and answer caused it, with the question text rendered in its own language element.

## Requirement 6 — Never claim eligibility (safety.md §1)

**User story:** As a user, I never want to be told I am eligible or that I qualify, because only
the study team decides that.

#### Acceptance Criteria

1. The system SHALL NOT output any text stating or implying that the person is eligible, qualifies,
   is a match, has been accepted, meets the criteria, is guaranteed, or is approved for the trial,
   in any supported language.
2. The system SHALL NOT contain any forbidden phrase listed in safety.md §1, in any supported
   language, in any user-facing fit-check copy (including the two outcome messages, questions,
   buttons, and reason text).
3. WHEN any outcome is shown, THEN the system SHALL frame the next step as contacting or asking the
   study team.
4. All user-facing English fit-check copy SHALL be at or below an 8th-grade reading level
   (safety.md §2).

## Requirement 7 — Empty, whitespace-only, or question-less criteria yield ask-team

**User story:** As a safety-conscious team, we want missing or garbled eligibility criteria to
produce "ask the study team", not "possible fit", so that an absence of information can never be
read as reassurance that a trial might fit.

> Target behavior (changes today's code — see design "Proposed change for the owner"). Today
> `lib/quickCheck.ts` returns `"possible-fit"` whenever `reasons.length === 0`, which includes the
> case where the eligibility text was empty and produced no questions. This requirement states the
> intended behavior, which requires a distinct reason so the two "zero-reason" cases can be told
> apart. The change is owned by Neil (`lib/quickCheck.ts`, `components/FitResult.tsx`,
> `lib/i18n/en.ts`) and lands via PR.

**Definition — "empty or malformed criteria" (precise):** for this requirement, criteria text is
treated as empty/malformed when, after trimming whitespace, it contains **no letters and no
digits** — i.e. it is the empty string, whitespace-only, or symbols/punctuation-only (for example
`""`, `"   \n\t "`, `"--- / . , ;"`). Text that contains at least one letter or digit is NOT
malformed for this purpose, even if it is messy.

#### Acceptance Criteria

1. WHEN `eligibility.criteriaText` is empty, whitespace-only, or malformed (no letters and no
   digits, per the definition above) AND no generated questions were produced from it, THEN the
   system SHALL record a distinct insufficient-info reason (a `FitReason.kind` of
   `"insufficient-info"`).
2. WHEN the insufficient-info reason has been recorded, THEN the outcome SHALL be `"ask-team"`,
   NOT `"possible-fit"`.
3. WHEN the person answered every shown question AND no reason was recorded (no structured
   mismatch, no rule-out answer, and the criteria did yield questions), THEN the outcome SHALL
   remain `"possible-fit"` — the insufficient-info reason SHALL NOT fire in this case.
4. WHEN there is at least one generated question, THEN the system SHALL NOT record the
   insufficient-info reason, regardless of how the questions are answered (questions exist, so the
   criteria were not question-less).
5. WHEN `eligibility.criteriaText` contains at least one letter or digit BUT no questions were
   generated from it, THEN the system SHALL NOT record the insufficient-info reason; instead it
   SHALL keep the structured-check result (age / sex / healthy volunteer) AND show the existing
   "ask the study team about the remaining rules" message (`fit.noQuestions`) for the free-text
   part. (This is the non-empty-but-question-less case; the text is still shown to the person, so
   it is not an absence of information.)
6. WHEN the outcome is `"ask-team"` because of the insufficient-info reason, THEN the system SHALL
   present a plain-language message telling the person to ask the study team about the remaining
   rules, framed as a caution and never as a failure or an eligibility statement.
7. The system SHALL handle arbitrary criteria text — including empty, whitespace-only,
   symbols-only, very long, and non-Latin-script input — without throwing.

**Preserves the tech.md LLM-failure fallback.** tech.md's last-resort fallback is "structured
quick-check only" (and structure.md's LLM-failure state: run the age / sex / healthy-volunteer
checks, skip the generated questions). In that failure mode there are **no generated questions**,
but the trial's `criteriaText` from the API is still present (it is not blanked by an LLM outage),
so it contains letters — the insufficient-info reason therefore does NOT fire (criterion 5 applies,
not criterion 1). The structured checks still produce their normal `possible-fit` / `ask-team`
result, exactly as the fallback intends. insufficient-info is reserved for a genuine absence of
eligibility text, not for a missing LLM.

## Requirement 8 — Answers stay in the browser (safety.md §3)

**User story:** As a user, I want my health answers to never leave my device, so that using the
fit-check carries no privacy cost.

#### Acceptance Criteria

1. The system SHALL hold the person's age, sex, healthy-volunteer answer, and question answers in
   in-browser state only.
2. The system SHALL NOT transmit the person's fit-check answers over the network to any server.
3. The system SHALL NOT persist the person's fit-check answers to storage, cookies, logs, or
   analytics.
4. The only data the system MAY send off-device for this feature SHALL be the trial lookup needed
   to obtain eligibility fields and generated questions — never the person's answers.

## Requirement 9 — Result gating and progress (grounded in QuickCheck.tsx)

**User story:** As a person using the fit-check, I want the result to appear only once I have
answered the questions on screen, so that a partial result is never misleading.

#### Acceptance Criteria

1. WHEN one or more answer groups are shown (sex, healthy-volunteer, or generated questions), THEN
   the system SHALL show the result only after every shown group has an answer, counting "not sure"
   as an answer.
2. WHEN no answer groups are shown AND a valid age has been entered, THEN the system SHALL show the
   result based on the structured age check alone.
3. WHILE not all shown groups are answered, the system SHALL show progress (how many of how many
   are answered) instead of a result.
4. WHEN the outcome or the number of reasons changes, THEN the system SHALL announce the updated
   result to assistive technology through a single status region.

## Requirement 10 — Contact and disclaimer always present (safety.md §4)

**User story:** As a user, I want the study's contact and the standard disclaimer visible whenever
I see a fit-check result, so that I always know the study team decides and how to reach them.

#### Acceptance Criteria

1. WHEN the fit-check is shown for a trial, THEN the surrounding trial view SHALL display the
   study's contact (central or site contact from the API).
2. WHEN the fit-check is shown, THEN the view SHALL display the disclaimer exactly:
   "TrialPath is not medical advice. The study team decides eligibility."
3. WHEN a result is shown, THEN the system SHALL direct the person to the study team's contact as
   the next step.
