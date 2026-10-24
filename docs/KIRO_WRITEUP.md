# How we used Kiro — TrialPath MA

This write-up is grounded in `KIRO_LOG.md`, `docs/TASKS.md`, and the files in `.kiro/`, plus the
state of the merged `main` branch. Claims cite their source. Where something genuinely hasn't been
done or observed yet, it is marked **TODO** rather than asserted. Honest caveats are kept in place —
they matter more than a polished story.

---

## 1. Kiro tools (IDE, CLI, Web, Crew)

We used Kiro across more than one surface, and the log is explicit about which did what:

- **Kiro Web** — the earlier session ran here. It authored the **steering** and **hooks**. The log
  notes that Web "does NOT execute event-driven hooks," so hook firing could not be observed there;
  the hook JSON authored in Web also used an invalid `FileSave` trigger that the IDE did not load.
- **Kiro IDE** — the later session. It authored the **specs**, the **property tests**, the **MCP
  `fetch` probes**, the **Context7 Power** review, and the **CLI run** below, and re-created the
  hooks through the Create Hook tool so they register in the Agent Hooks panel (with the valid
  `PostFileSave` trigger). Per the IDE Output log, 3 of 3 hooks registered once the workspace was
  trusted.
- **Kiro CLI** — used. The CLI is `kiro-cli.exe` (installer-reported version **2.34.0**, installed
  under `AppData\Local\kiro-cli`). Given the prompt "Run `npx vitest run` and summarize which tests
  fail and why. Don't edit any files," it ran the command, read `lib/i18n/i18n.test.ts` and
  `lib/i18n/dictionaries.ts`, made **no edits**, and finished in **23 seconds**. **Historical
  result at that time: 62 tests, 57 passed and 5 failed** — all 5 were the "`<lang> has every key`"
  completeness test, because the non-English translation dictionaries were still empty `{}`. **That
  cause is fixed on `main`** (the dictionaries are filled), so those 5 failures no longer apply —
  see the integrated snapshot in "Still pending." The `kiro` command is a different binary: the
  **IDE launcher** (`kiro --version` → 1.4.26), not the agentic `kiro-cli.exe`.
- **Kiro Crew** — used for **two read-only review sessions, run sequentially (one after the other,
  not in parallel), with no files edited** (per `KIRO_LOG.md`). Session 1 reviewed
  `docs/QA_CHECKLIST.md` against `safety.md` and reported the missing safety checks (Vietnamese
  phrases, contact/disclaimer on non-trial pages, answers never logged server-side, no diagnosis
  advice, and more) — those gaps are now folded into the checklist's §6. Session 2 checked every
  `done` task across the specs for orphaned claims and found none. We make **no claim of parallel
  runs or orchestration** — the sessions ran one at a time and changed nothing in the tree.

The CLI run's 5 failures were the empty non-English dictionaries; those dictionaries are now filled
and the merged `main` suite is green (see "Integrated snapshot & attribution").

**How the surfaces differed.** The **IDE** was where we built: specs, steering, hooks, MCP, and the
Power. The **CLI** ran the test suite from a terminal. **Crew** reviewed our safety checks in
read-only sessions — its review found **nine gaps in the safety section of our QA checklist, which
we then fixed**. In short: the IDE built things; the CLI and Crew checked them from outside the
editing loop.

---

## 2. Spec-driven vs vibe coding

We used spec-driven development for the features where safety and correctness mattered, and kept
each spec grounded in the code that already exists rather than an idealized design.

Specs in `.kiro/specs/` (confirmed present):

- **fit-check** — EARS **requirements + design + tasks** (`.kiro/specs/fit-check/` on `main` has
  all three), grounded in `lib/quickCheck.ts`, `lib/quickCheck.test.ts`, `components/QuickCheck.tsx`,
  `components/FitResult.tsx`, and `safety.md`. Outcomes were pinned to the two values the code
  actually returns today (`possible-fit` / `ask-team`) and the real `FitReason.kind` set. The spec
  also recorded a **finding + decision**: `quickCheck` returns `possible-fit` for empty criteria
  with no questions, which should be the cautious `ask-team`; the fix (a distinct `insufficient-info`
  reason) was drafted as a "Proposed change for the owner" and left for the file owner. Per
  `docs/TASKS.md`, that cautious `quickCheck` fallback is Neil's and is still pending.
- **getting-there** — EARS **requirements + design + tasks**. **12 tasks the existing code already
  satisfies** were marked done with the file that satisfies each; **5 known gaps** (G1–G5,
  including "the MBTA fetch does not exist on `main`") were catalogued with owner drafts in the
  design. Nothing in `lib/`, `app/`, or `components/` was edited.
- **translation** — EARS **requirements + design + tasks**. 9 requirements; satisfied-today
  behaviors marked inline (e.g. `parseSimplified` normalizes/rejects payloads and carries `lang`
  through; `findForbiddenPhrase` already covers es/pt/ht/zh; `getDictionary` English fallback;
  `HTML_LANG` uses `zh-Hans`). Gaps the spec recorded **at the time it was written**: no translation
  call, no `(NCT id, language)` cache, no machine-translated flag, the forbidden-phrase gate not
  wired to translation output, and empty `dictionaries.ts` maps. (The empty-dictionaries gap has
  since been closed on `main`.) Owner drafts live inside the design only.

All three — **fit-check, getting-there, and translation — were written in the Kiro IDE.**
getting-there's earlier version is preserved on `main` under
`.kiro/specs/getting-there/planning-reference/` (added by Hasan's merge, per `KIRO_LOG.md`).

A fourth spec, **`.kiro/specs/trialpath-ui/`, is a retrospective spec written in Codex, not Kiro**
— `KIRO_LOG.md` states it was "prepared retrospectively in Codex" and is "**review documentation,
not proof of Kiro-authored spec-first development**." We do not count it as evidence of spec-first
Kiro development.

**What writing the specs surfaced.** Writing the **fit-check** spec exposed that our steering doc
describes **three** quick-check outcomes while the code has **two**. We hadn't noticed before, and
it's still an **open team decision**.

One spec — for the **UI** (`trialpath-ui`) — was written **after** the code, as a retrospective, so
we **cannot claim spec-first there**.

**Vibe coding.** We did **not** build a vibe-coded version to compare against, so we **cannot
measure the difference** between spec-driven and vibe coding.

---

## 3. Hooks

Three agent hooks live in `.kiro/hooks/` (all parse as `version: v1`):

- **Copy guard** — `PostFileSave`, matcher
  `(lib[\\/]i18n[\\/].*\.ts$|components[\\/].*\.(tsx|ts)$|app[\\/].*\.tsx$)` (the `[\\/]` accepts
  both forward- and back-slash path styles), running `node tests/copy-guard.mjs` on the saved file.
  It flags forbidden eligibility phrases in **EN/ES/PT/HT/ZH/VI** and English copy above an
  8th-grade reading level. It grades only real sentences (≥ 8 words, ends in punctuation) to avoid
  false positives on short UI labels, has a Tailwind/CSS heuristic so `className` strings aren't
  graded, and exempts the fixed §4 disclaimer.
- **Test on save** — `PostFileSave`, matcher `(lib|tests)/.*\.ts$`, runs `npm test` (Vitest,
  `vitest run`, no watch).
- **Update docs** — a **Manual** hook that documents intent and lists in the panel; because v1 has
  no general-purpose manual trigger, the actually-runnable counterpart is the manual-inclusion
  steering command `/update-docs` (`.kiro/steering/update-docs.md`), which runs
  `tests/update-docs.mjs`.

What the log shows the hooks catching / doing:

- The IDE showed **"Run Command Hook: Test on save" triggered automatically when the agent wrote
  `tests/scratch-scan-count.test.ts`**, and **"Run Command Hook: Copy guard" triggered when the
  agent wrote `components/_hooktest.tsx`.** These were **agent file writes, not manual saves**, and
  the **hook output panel text was not captured**.
- Copy guard flagged a scratch file containing "you qualify for this trial" (`[forbidden:en]`,
  exit 2) and the Spanish "usted califica"; the scratch files were reverted/deleted and the tree
  left clean.
- Copy guard also flagged one **real** over-limit string in `lib/i18n/en.ts` —
  `results.tryWider` at reading grade 8.4 — which was flagged to the i18n owner rather than edited.
- A **silent-pass bug** (the script exited 0 when invoked with no file args) was found and fixed so
  it now default-scans `lib/i18n/`, `components/`, and `app/**/*.tsx` and never passes silently.
  This Copy guard work merged into `main` via **PR #13** (`akash/kiro`, merge commit `6c5a83a`, per
  `KIRO_LOG.md`).

The **manual `/update-docs` steering command is distinct from these hooks** — it is a
manual-inclusion command (`.kiro/steering/update-docs.md`), not a `PostFileSave` hook. The
`update-docs.json` hook file exists only to document intent and list in the panel; v1 has no
runnable manual hook trigger.

> **Honest note — scope of what was observed.** The IDE showed both hooks trigger on **agent file
> writes**; a **manual-save trigger was not separately observed**, and the **hook output panel text
> was not captured**. Earlier in the log, hook behavior was also verified by running each hook's
> exact `action.command` against a test file (command-equivalence). It remains a real **TODO** to
> observe a manual on-save fire with captured panel output and screenshot it for the demo.

---

## 4. Steering

`.kiro/steering/` holds the project's always-on guidance (confirmed files: `safety.md`,
`product.md`, `tech.md`, `structure.md`, plus the manual `update-docs.md`):

- **safety.md** — the non-negotiables every other doc references: never claim eligibility (with a
  multilingual forbidden-phrase list — EN/ES/PT/HT/ZH, plus VI below), ≤ 8th-grade reading level,
  health answers stay in the browser, always show contact + disclaimer, and preserve NCT IDs /
  phone numbers / emails verbatim in translation. Generated copy and code inherit these guardrails.
  - **Vietnamese forbidden phrases.** Five VI equivalents were added to `safety.md` §1 (and to
    `tests/copy-guard.mjs`) before `vi` ships: "bạn đủ điều kiện", "bạn đủ tiêu chuẩn", "bạn phù
    hợp", "bạn đáp ứng các tiêu chí", "được bảo đảm". Per `KIRO_LOG.md`, these are
    **machine-drafted and still need review by a Vietnamese speaker** — they are not verified.
- **tech.md** — the decided stack, including Bedrock set to **Nova 2 Lite**
  (`us.amazon.nova-2-lite-v1:0`) with **Nova Pro** fallback (`us.amazon.nova-pro-v1:0`), region
  us-east-2, a note that Claude is unavailable on the AWS Free plan, and the Vercel env var names.
- **structure.md** — the folder layout, the canonical-units decision (miles in `lib/`, convert only
  at the MBTA boundary), the ownership map (who owns which folders), accessibility rules, and the
  empty/error-state rules (LLM-failure → structured quick-check only; no-transit → driving link).
- **product.md** — MVP scope and the language set (EN/ES/PT/HT/ZH, Vietnamese stretch).
- **update-docs.md** — a `inclusion: manual` steering command (`/update-docs`) that runs the
  docs-refresh script; the runnable counterpart to the Update docs hook.

Steering also evolved via review: a toothless "never returns eligible" property (guaranteed by the
TS union) was replaced with behavioral invariants, the forbidden-phrase list was made multilingual
and required to run on **cached translations**, and the "Chinese" ambiguity was resolved to
**Simplified Chinese**.

**One source, three enforcers.** We wrote the safety rules once in `safety.md`: no eligibility
claims, forbidden phrases per language, a verbatim disclaimer, an 8th-grade reading level, and
answers staying in the browser. Kiro read that file on every chat. The **same rules** fed the
**copy-guard hook** and the **property tests**, so the steering doc, the hook, and the tests all
enforce **one source**.

---

## 5. MCP

The `fetch` MCP server is configured in `.kiro/settings/mcp.json` as `uvx mcp-server-fetch` with
the arg `--ignore-robots-txt`. The log records it **connecting and running real network calls in
the IDE** to confirm field shapes before any parser was written:

- **MBTA V3 `/stops`** — confirmed live: a Mass General area query returned 261 stops in JSON:API
  format, with `wheelchair_boarding` present (values 1 and 2 seen; 0 not seen), and coordinates in
  `attributes.latitude`/`attributes.longitude`.
- **ClinicalTrials.gov v2 `/api/v2/studies`** — confirmed live **after unblocking**. The exact
  sequence from the log: (1) the first attempt was **blocked by robots.txt** (`Disallow: /api/`),
  so `mcp-server-fetch` refused the URL; (2) adding `--ignore-robots-txt` to the server args wasn't
  enough on the immediate retry because the running server hadn't picked up the new args; (3) after
  **restarting the fetch server** with the flag, the retry **succeeded** and returned 5 studies.
  From that response we confirmed real `eligibilityModule` fields (`minimumAge`, sometimes-absent
  `maximumAge`, `sex`, `healthyVolunteers`, `eligibilityCriteria`), `geoPoint` on all locations,
  and `centralContacts` on 4 of 5 (with a real name/phone/email).

> **Honest note — the robots.txt block.** The write-up keeps this exactly as it happened: fetch was
> blocked by robots.txt until the `--ignore-robots-txt` flag was added **and** the server was
> restarted. It was not a clean first-try success.

---

## 6. Property-based testing (fast-check)

The log records **16 fast-check properties across two files, all passing** (15 initially, plus one
added with the Vietnamese work):

- `tests/safety.property.test.ts` (9 properties): `haversineMi` symmetric / non-negative / zero for
  identical points; `quickCheck` outcome always in the allowed set and out-of-range age →
  `ask-team`; empty/malformed eligibility text never throws and never fabricates an outcome; and a
  forbidden-phrase scan over shipped i18n + mock fixtures (now including the `vi` dictionary and
  fixtures — no safety.md phrase in any language, no bare "eligible"/"qualify" outside the mandated
  §4 disclaimer, plus a guard that fails on an empty scan).
- `tests/copy-guard.property.test.mjs` (7 properties) over the pure functions exported from
  `tests/copy-guard.mjs`: `readingGrade` is deterministic and finite and never throws on any string
  (empty, whitespace, Chinese, 2k–5k chars); the forbidden-phrase checker never throws on arbitrary
  Unicode; appending any forbidden phrase to any string always flags it regardless of surrounding
  casing/whitespace; and each Vietnamese phrase is detected and tagged `lang="vi"`.

**A property test caught a real bug.** Our older **unit** test locked in `possible-fit` for empty
criteria — **that was the bug**. The **property** test generated empty and no-letter criteria and
**failed**, and that failure **exposed the gap**. We recorded it as an **expected failure**; the fix
is in **PR #16 (under review)**, and we'll convert it to a normal passing test once it's integrated.

Other findings the properties surfaced (about the code shape):

- `parseAge`, `rankBySiteDistance`, and `readingGrade` **don't exist as pure `lib/` functions** on
  `main`, so the guard's own `readingGrade` (in `tests/`) was exported and tested instead.
- The steering docs describe three `quickCheck` outcomes (`possible-fit` / `may-rule-out` /
  `not-sure`), but the real code returns only `possible-fit` / `ask-team`; tests were written
  against the **real two-outcome contract**. This two-vs-three mismatch is an **open decision still
  to be settled with the team**.

---

## 7. Powers

We used the **Context7** Power (MCP server `context7`, tools `resolve-library-id` + `query-docs`)
to check our code against current docs for the exact installed versions (Next.js 16.4.3,
fast-check ^4.10.2). The log records 6 real calls that reviewed:

- **proxy.ts** — Next 16 renamed `middleware.ts` → `proxy.ts`; our named `proxy` export,
  `NextRequest`, and `config.matcher` (array form with a negative-lookahead regex) match the
  current convention.
- **`[lang]` routing + `generateStaticParams`** — async `params` is a Promise to await;
  `PageProps`/`LayoutProps` are the current typed helpers; our layout/pages follow it.
- **fast-check API** — `fc.assert(fc.property(...))`, `fc.string()`, and the v4 `fc.string({ unit:
  "binary" })` form (replacing v3 `fc.fullUnicodeString()`) are current, and we already use the new
  form.

> **Honest note — used, not decisive.** We installed and used **Context7 for library
> documentation**, but we **did not observe it change a design decision**, so we report it as
> **used, not decisive**. (The net result was that proxy.ts, the `[lang]` routing, and the
> fast-check usage all matched current conventions, and no code was changed.)

**Other Powers:** **TODO.** The log records only the Context7 Power; no other Power is documented.

---

## Integrated snapshot & attribution

The integrated `main` snapshot is **178 tests passing** (per `KIRO_LOG.md`, after merging `main`
into `akash/kiro`, `npx vitest run` → 14 files / 178 tests, all passing; `node tests/copy-guard.mjs`
over the six dictionaries → no violations). With the Vietnamese additions the suite is **179 tests
passing**. The empty-dictionaries cause of the earlier CLI-run failures is fixed, so the "5 failing"
and "empty dictionaries" statuses are historical, not current.

**PR attribution.** PR merges are performed from the **`hasaninan18`** GitHub account, per
`docs/TASKS.md` (e.g. PR #13, `akash/kiro` → `main`, merge commit `6c5a83a`). That is the merge
mechanic only — it does not change who did the underlying work.

---

## Still pending

Per `docs/TASKS.md` on `main`. None of the following is claimed complete:

- **Hasan — simplify route.** Finishing the `/api/simplify` route: source-evidence and age
  validation, plus real English and Spanish verification.
- **Neil — cautious fallback + frontend QA.** Owns the cautious `quickCheck` fallback (the
  `insufficient-info` reason drafted in the fit-check spec) and the remaining frontend QA.

---

## Honest-notes summary

Kept front-and-center because they're the truthful version of the story:

1. **Hook firing on a real save was never confirmed.** The IDE showed both hooks trigger on **agent
   file writes**, but a **manual-save trigger was not separately observed** and the **hook output
   panel text was not captured**. A real manual on-save fire + panel screenshot is still **TODO**.
2. **A property test caught a real bug** — it failed on empty / no-letter criteria (the
   `possible-fit` bug an older unit test had locked in) and was recorded as an expected failure; the
   fix is in PR #16 (under review) and will become a normal passing test once integrated.
3. **Context7 found no problems** — the Powers review confirmed our conventions and changed no code.
4. **fetch MCP was blocked by robots.txt** on ClinicalTrials.gov until `--ignore-robots-txt` was
   added **and** the fetch server restarted.
5. **Kiro CLI ran** (`npx vitest run`, no edits, 23s) and reported 62 tests / 57 passed / 5 failed
   **at that time**; those 5 (empty dictionaries) are fixed on `main` (now 178 / 179 passing).
6. **`trialpath-ui` is a Codex retrospective spec**, not evidence of spec-first Kiro development.
7. **Vietnamese forbidden phrases are machine-drafted** and still need review by a Vietnamese
   speaker before `vi` ships.

### Remaining real TODOs

- **Vibe coding** — the log attributes no specific feature code to an unstructured ("vibe") Kiro
  session, so we claim no vibe-vs-spec split beyond "specs covered the safety-critical features."
- **A manual-save hook observation with captured panel output** — hooks were seen firing on agent
  file writes, but a manual on-save fire with the panel text captured (and a demo screenshot)
  hasn't been done.
- **Vietnamese phrase review** — the five VI forbidden phrases need a Vietnamese speaker's sign-off
  before `vi` ships.
- **The two-vs-three `quickCheck` outcome mismatch** — an open decision to settle with the team.
