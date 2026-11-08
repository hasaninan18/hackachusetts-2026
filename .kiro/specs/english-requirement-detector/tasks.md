# Tasks — english-requirement-detector

Status reflects the branch at time of writing. API/UI integration is deliberately not a
task here (see requirements.md, "Out of scope").

- [x] 1. Spec: requirements and design from the hand-off contract and fixtures.
  - _Requirements: all_

- [x] 2. Copy the pinned fixture byte-for-byte to `lib/test-fixtures/english-requirement.json`
  - SHA-256 `67f55f6ec93b57f8e4d21f7fdba8e682c35b39dd56a20dfb3c166d29e57dfc21`, verified on the
    working copy and on the committed blob. LF-only; see design.md for the CRLF note.
  - _Requirements: 9.1_

- [x] 3. Detector module `lib/english-requirement.ts`
  - [x] 3.1 Export `EnglishRequirement`, `NotRequiredReason`, `detectEnglishRequirement`.
        _Requirements: 1.1, 1.2_
  - [x] 3.2 Reuse `splitSections` / `sectionLines` / `normalizeLine` from
        `lib/simplify-mappings.ts` (not edited); no second heading parser. _Requirements: 2.1–2.3_
  - [x] 3.3 Line classification: veto (other language, interpreter/translation, permissive
        wording) → subject → ability → polarity. _Requirements: 2.4–2.6, 2.8, 3.1–3.3, 4.1_
  - [x] 3.4 Study decision with global veto precedence; evidence in document order with
        original casing. _Requirements: 2.7, 3.4, 4.2, 5.1, 5.2_

- [x] 4. Tests `lib/english-requirement.test.ts` (initially failing, then fixed)
  - [x] 4.1 Fixture integrity, no-flag/flag assertions, coverage table for "either".
        _Requirements: 9.1–9.5_
  - [x] 4.2 Behavior regressions: polarity both ways, veto precedence (incl. veto after an
        earlier unclear line), subject lines, missing/duplicate/out-of-order headings, English
        outside sections, evidence order/casing, format changes, 50,000+ chars, non-Latin.
  - [x] 4.3 Properties R10.1–R10.6 with fast-check (300–500 runs each).
  - [x] 4.4 First run against the literal-contract implementation (commit "Add
        English-requirement detector and tests"): 6 of 136 failed, including the hard
        no-flag assertion on `real-line-30` ("child is exposed to English"), which returned
        `required`.
  - [x] 4.5 Fix: an English line must state a patient language ability before polarity is
        applied (requirements 2.8). All 136 pass.
  - [x] 4.6 Hardening beyond the fixtures: hedged wording ("is preferred", "if possible",
        "unless …", "will be accommodated") returned `required` or `unclear`; 5 new tests
        failed first, then pass after adding hedge vetoes (requirements 3.3). 141 pass.

- [x] 5. Repo checks: `npm ci`, `npx vitest run --no-file-parallelism`, `npm run typecheck`,
      `npm run lint`, `npm run build`, `node tests/copy-guard.mjs` (results in the PR).

- [ ] 6. Independent review before the PR is marked ready. The first review (of 29df554)
      returned four false positives; see task 8. A second review is pending.

- [ ] 7. (Separate design, not this branch) API/UI integration for live search, detail and
      DB results, after the BMC pre-send fixes land.

- [x] 8. Independent-review fixes (built with Claude Code, like tasks 1–5)
  - [x] 8.1 Add the reviewer's regression file unchanged as
        `lib/english-requirement.review.test.ts`; on 29df554 it fails 4/4.
  - [x] 8.2 General fixes in `lib/english-requirement.ts`: inability words are negations;
        exclusion negation must be bound to English; ability must be a language-use word in
        the same clause as English ("able"/"ability" alone no longer count); vetoes checked
        on every English line of the whole text. _Requirements: 2.4, 2.5, 2.8, 3.4_
  - [x] 8.3 `lib/english-requirement.scope.test.ts`: general variants, positive controls,
        300,000+ character guard, properties R10.7–R10.8. _Requirements: 10.7, 10.8_
  - [x] 8.4 Rerun repo checks and the fixture hash (results in the PR).
