# How we used Kiro ΓÇö TrialPath MA

This write-up is sourced **only** from `KIRO_LOG.md` and the files in `.kiro/`. Where the log does
not support a claim, it is marked **TODO** rather than asserted. Honest caveats from the log are
kept in place ΓÇö they matter more than a polished story.

---

## 1. Kiro tools (IDE, CLI, Web, Crew)

We used Kiro across more than one surface, and the log is explicit about which did what:

- **Kiro Web** ΓÇö the earlier sessions ran here. The log notes that Web "does NOT execute
  event-driven hooks," so hook firing could not be observed there; the hook JSON authored in Web
  also used an invalid `FileSave` trigger that the IDE did not load.
- **Kiro IDE** ΓÇö a later session re-created the hooks through the IDE's Create Hook tool so they
  register in the Agent Hooks panel (with the valid `PostFileSave` trigger), and ran the MCP
  `fetch` probes and the Context7 Power. Per the IDE Output log, 3 of 3 hooks registered once the
  workspace was trusted.
- **Kiro CLI** ΓÇö **TODO.** The log mentions the IDE's `/hooks` panel as a place to verify hooks,
  but records no actual Kiro CLI session.
- **Kiro Crew** ΓÇö **TODO.** The "Kiro tools / Crew / Powers" section of the log contains hook and
  Powers entries but **no Crew run** (e.g. no parallel spec-task execution). We make no Crew claim.

> Honest note: the log's clearest tool caveat is that hook execution was verified by running the
> backing scripts as the hook would, **not** by observing the IDE fire a hook on a real save.

---

## 2. Spec-driven vs vibe coding

We used spec-driven development for the features where safety and correctness mattered, and kept
each spec grounded in the code that already exists rather than an idealized design.

Specs in `.kiro/specs/` (confirmed present):

- **fit-check** ΓÇö EARS **requirements only**, grounded in `lib/quickCheck.ts`,
  `lib/quickCheck.test.ts`, `components/QuickCheck.tsx`, `components/FitResult.tsx`, and
  `safety.md`. Outcomes were pinned to the two values the code actually returns today
  (`possible-fit` / `ask-team`) and the real `FitReason.kind` set. The spec also recorded a
  **finding + decision**: `quickCheck` returns `possible-fit` for empty criteria with no questions,
  which should be the cautious `ask-team`; the fix (a distinct `insufficient-info` reason) was
  drafted as a "Proposed change for the owner" and left for the file owner, not applied.
- **getting-there** ΓÇö EARS **requirements + design + tasks**. **12 tasks the existing code already
  satisfies** were marked done with the file that satisfies each; **5 known gaps** (G1ΓÇôG5,
  including "the MBTA fetch does not exist on `main`") were catalogued with owner drafts in the
  design. Nothing in `lib/`, `app/`, or `components/` was edited.
- **translation** ΓÇö EARS **requirements + design + tasks**. 9 requirements; satisfied-today
  behaviors marked inline (e.g. `parseSimplified` normalizes/rejects payloads and carries `lang`
  through; `findForbiddenPhrase` already covers es/pt/ht/zh; `getDictionary` English fallback;
  `HTML_LANG` uses `zh-Hans`). Known gaps marked inline: no translation call, no
  `(NCT id, language)` cache, no machine-translated flag, the forbidden-phrase gate not wired to
  translation output, and empty `dictionaries.ts` maps. Owner drafts live inside the design only.

The pattern across all three: **spec-driven, grounded, and honest about gaps** ΓÇö each spec
separates "what the code does today" from "what's proposed," and defers owner-file edits to a PR.

Vibe coding: **TODO.** The log does not attribute specific feature code to an unstructured
("vibe") Kiro session, so we don't claim a vibe-vs-spec split beyond "specs covered the
safety-critical features."

---

## 3. Hooks

Three agent hooks live in `.kiro/hooks/` (all parse as `version: v1`):

- **Copy guard** ΓÇö `PostFileSave`, matcher `(lib/i18n/.*\.ts$|components/.*\.(tsx|ts)$|app/.*\.tsx$)`,
  runs `tests/copy-guard.mjs` on the saved file. It flags forbidden eligibility phrases in
  EN/ES/PT/HT/ZH and English copy above an 8th-grade reading level. It grades only real sentences
  (ΓëÑ 8 words, ends in punctuation) to avoid false positives on short UI labels, has a Tailwind/CSS
  heuristic so `className` strings aren't graded, and exempts the fixed ┬º4 disclaimer.
- **Test on save** ΓÇö `PostFileSave`, matcher `(lib|tests)/.*\.ts$`, runs `npm test` (Vitest,
  `vitest run`, no watch).
- **Update docs** ΓÇö a **Manual** hook that documents intent and lists in the panel; because v1 has
  no general-purpose manual trigger, the actually-runnable counterpart is the manual-inclusion
  steering command `/update-docs` (`.kiro/steering/update-docs.md`), which runs
  `tests/update-docs.mjs`.

What the log shows the hooks catching / doing:

- Copy guard flagged a scratch file containing "you qualify for this trial" (`[forbidden:en]`,
  exit 2) and the Spanish "usted califica"; the scratch files were reverted/deleted and the tree
  left clean.
- Copy guard also flagged one **real** over-limit string in `lib/i18n/en.ts` ΓÇö
  `results.tryWider` at reading grade 8.4 ΓÇö which was flagged to the i18n owner rather than edited.
- A **silent-pass bug** (the script exited 0 when invoked with no file args) was found and fixed so
  it now default-scans `lib/i18n/`, `components/`, and `app/**/*.tsx` and never passes silently.

> **Honest note ΓÇö hook firing was never confirmed on a real save.** The log is repeated and
> explicit: hook behavior was verified by running each hook's exact `action.command` against a
> test file (command-equivalence), **not** by observing the Kiro IDE trigger the hook on an actual
> file save. It remains **TODO** to save a matching file in the IDE, watch the Agent Hooks panel
> fire, and screenshot it for the demo. Also noted: `npm test`/`vitest run` currently shows 5
> pre-existing i18n dictionary-key failures, unrelated to the hooks.

---

## 4. Steering

`.kiro/steering/` holds the project's always-on guidance (confirmed files: `safety.md`,
`product.md`, `tech.md`, `structure.md`, plus the manual `update-docs.md`):

- **safety.md** ΓÇö the non-negotiables every other doc references: never claim eligibility (with a
  multilingual forbidden-phrase list), Γëñ 8th-grade reading level, health answers stay in the
  browser, always show contact + disclaimer, and preserve NCT IDs / phone numbers / emails verbatim
  in translation. Generated copy and code inherit these guardrails.
- **tech.md** ΓÇö the decided stack, including Bedrock set to **Nova 2 Lite**
  (`us.amazon.nova-2-lite-v1:0`) with **Nova Pro** fallback (`us.amazon.nova-pro-v1:0`), region
  us-east-2, a note that Claude is unavailable on the AWS Free plan, and the Vercel env var names.
- **structure.md** ΓÇö the folder layout, the canonical-units decision (miles in `lib/`, convert only
  at the MBTA boundary), the ownership map (who owns which folders), accessibility rules, and the
  empty/error-state rules (LLM-failure ΓåÆ structured quick-check only; no-transit ΓåÆ driving link).
- **product.md** ΓÇö MVP scope and the language set (EN/ES/PT/HT/ZH, Vietnamese stretch).
- **update-docs.md** ΓÇö a `inclusion: manual` steering command (`/update-docs`) that runs the
  docs-refresh script; the runnable counterpart to the Update docs hook.

Steering also evolved via review: a toothless "never returns eligible" property (guaranteed by the
TS union) was replaced with behavioral invariants, the forbidden-phrase list was made multilingual
and required to run on **cached translations**, and the "Chinese" ambiguity was resolved to
**Simplified Chinese**.

---

## 5. MCP

The `fetch` MCP server is configured in `.kiro/settings/mcp.json` as `uvx mcp-server-fetch` with
the arg `--ignore-robots-txt`. The log records it **connecting and running real network calls in
the IDE** to confirm field shapes before any parser was written:

- **MBTA V3 `/stops`** ΓÇö confirmed live: a Mass General area query returned 261 stops in JSON:API
  format, with `wheelchair_boarding` present (values 1 and 2 seen; 0 not seen), and coordinates in
  `attributes.latitude`/`attributes.longitude`.
- **ClinicalTrials.gov v2 `/api/v2/studies`** ΓÇö confirmed live **after unblocking**. The exact
  sequence from the log: (1) the first attempt was **blocked by robots.txt** (`Disallow: /api/`),
  so `mcp-server-fetch` refused the URL; (2) adding `--ignore-robots-txt` to the server args wasn't
  enough on the immediate retry because the running server hadn't picked up the new args; (3) after
  **restarting the fetch server** with the flag, the retry **succeeded** and returned 5 studies.
  From that response we confirmed real `eligibilityModule` fields (`minimumAge`, sometimes-absent
  `maximumAge`, `sex`, `healthyVolunteers`, `eligibilityCriteria`), `geoPoint` on all locations,
  and `centralContacts` on 4 of 5 (with a real name/phone/email).

> **Honest note ΓÇö the robots.txt block.** The write-up keeps this exactly as it happened: fetch was
> blocked by robots.txt until the `--ignore-robots-txt` flag was added **and** the server was
> restarted. It was not a clean first-try success.

---

## 6. Property-based testing (fast-check)

The log records **15 fast-check properties across two files, all passing**:

- `tests/safety.property.test.ts` (9 properties): `haversineMi` symmetric / non-negative / zero for
  identical points; `quickCheck` outcome always in the allowed set and out-of-range age ΓåÆ
  `ask-team`; empty/malformed eligibility text never throws and never fabricates an outcome; and a
  forbidden-phrase scan over shipped i18n + mock fixtures (no safety.md phrase in any language, no
  bare "eligible"/"qualify" outside the mandated ┬º4 disclaimer, plus a guard that fails on an empty
  scan).
- `tests/copy-guard.property.test.mjs` (6 properties) over the pure functions exported from
  `tests/copy-guard.mjs`: `readingGrade` is deterministic and finite and never throws on any string
  (empty, whitespace, Chinese, 2kΓÇô5k chars); the forbidden-phrase checker never throws on arbitrary
  Unicode; and appending any forbidden phrase to any string always flags it regardless of
  surrounding casing/whitespace.

Findings the properties surfaced (about the code shape, not property failures):

- `parseAge`, `rankBySiteDistance`, and `readingGrade` **don't exist as pure `lib/` functions** on
  `main`, so the guard's own `readingGrade` (in `tests/`) was exported and tested instead.
- The steering docs describe three `quickCheck` outcomes (`possible-fit` / `may-rule-out` /
  `not-sure`), but the real code returns only `possible-fit` / `ask-team`; tests were written
  against the **real two-outcome contract**.

> **Honest note ΓÇö no property failed.** The log is explicit: all 15 passed and **no counterexample
> was found.** The properties document and lock in today's real behavior and catch no-throw /
> safety invariants; they did **not** catch a live bug in this run. We don't claim otherwise.

---

## 7. Powers

We used the **Context7** Power (MCP server `context7`, tools `resolve-library-id` + `query-docs`)
to check our code against current docs for the exact installed versions (Next.js 16.4.3,
fast-check ^4.10.2). The log records 6 real calls that reviewed:

- **proxy.ts** ΓÇö Next 16 renamed `middleware.ts` ΓåÆ `proxy.ts`; our named `proxy` export,
  `NextRequest`, and `config.matcher` (array form with a negative-lookahead regex) match the
  current convention.
- **`[lang]` routing + `generateStaticParams`** ΓÇö async `params` is a Promise to await;
  `PageProps`/`LayoutProps` are the current typed helpers; our layout/pages follow it.
- **fast-check API** ΓÇö `fc.assert(fc.property(...))`, `fc.string()`, and the v4 `fc.string({ unit:
  "binary" })` form (replacing v3 `fc.fullUnicodeString()`) are current, and we already use the new
  form.

> **Honest note ΓÇö Context7 found no problems.** The net result in the log is that proxy.ts, the
> `[lang]` routing, and the fast-check usage all match current conventions for the installed
> versions, and **no code was changed** ΓÇö it was a docs-grounded review only, not a bug fix.

**Other Powers:** **TODO.** The log records only the Context7 Power; no other Power is documented.

---

## Honest-notes summary

Kept front-and-center because they're the truthful version of the story:

1. **Hooks firing on a real save was never confirmed** ΓÇö verified by command-equivalence only; a
   real IDE on-save fire + Agent Hooks panel screenshot is still **TODO**.
2. **No property failed** ΓÇö all 15 fast-check properties passed; no counterexample found. They lock
   in existing behavior rather than having caught a live bug this run.
3. **Context7 found no problems** ΓÇö the Powers review confirmed our conventions and changed no code.
4. **fetch MCP was blocked by robots.txt** on ClinicalTrials.gov until `--ignore-robots-txt` was
   added **and** the fetch server restarted.

Unresolved **TODO**s for a complete write-up: confirm whether **Kiro CLI** and **Kiro Crew** were
used (no log evidence), identify any genuinely **vibe-coded** work, and capture the demo
screenshots the log asks for (hook firing, Agent Hooks panel).
