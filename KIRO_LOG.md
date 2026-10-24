# KIRO_LOG

A running log of how we used Kiro to build TrialPath MA. One line per meaningful thing Kiro did for us — this feeds the hackathon write-up and the demo video's "how we built it" section.

Format: `- [time] <area> — what Kiro did / what it caught / why it mattered`

## Steering
- [pre-11:30] steering — Created `.kiro/steering/{safety,product,tech,structure}.md` + `KIRO_LOG.md` with Kiro. `safety.md` encodes the non-negotiables (never claim eligibility, ≤ 8th-grade reading level, health answers stay in the browser, always show contact + disclaimer, preserve NCT/phone/email in translation). Everything else references these rules so generated copy and code inherit the guardrails. Shipped as PR #1.
- [Step 1b] steering (Bedrock + layout update) — Per Hasan's TASKS.md update: set Bedrock model to **Nova 2 Lite** (`us.amazon.nova-2-lite-v1:0`) with fallback **Nova Pro** (`us.amazon.nova-pro-v1:0`), region us-east-2 confirmed, noted Claude is unavailable on the AWS Free plan, removed the verify notes, and documented the Vercel env vars (`AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_FALLBACK_MODEL_ID`). Switched test convention to **co-located** (`lib/geo.test.ts`, not `lib/__tests__/`) to match Neil's scaffold, and synced the folder-layout + ownership map to TASKS.md.
- [Step 1] steering (reconcile w/ playbook) — Aligned to Hasan's explicit Step 1 asks: switched lib/ canonical unit from km to **miles** (haversine/rank/display in mi; only milesToMbtaDegrees converts at the MBTA boundary); added **Chinese (Simplified)** forbidden phrases and moved it into demo scope (Vietnamese now the lone stretch language, labeled machine-translated); added **LLM-failure → structured quick-check only** and **no-transit → driving-directions link** to the empty/error states.
- [pre-11:30] steering (review round) — Hasan reviewed; tightened per feedback: replaced the toothless "never returns eligible" property (the TS union already guarantees it) with behavioral invariants (quickCheck monotonicity, out-of-range age → may-rule-out, empty/malformed text → never possible-fit, parseAge handles "6 Months"/"N/A"/"No maximum"/junk). Added a single-canonical-unit rule (km in lib/, convert at edges) to kill the miles/degrees mismatch. Made the forbidden-phrase list multilingual + run the hook on cached translations. Narrowed demo languages to EN/ES/PT/HT and resolved the "Chinese" ambiguity (label Simplified-Mandarin or Traditional-Cantonese if added). Added accessibility + empty/error-state rules to structure.md. Flagged the Bedrock region/inference-profile claims as "verify in AWS."

## Specs
<!-- e.g. - [time] spec:trial-search — generated EARS requirements; design; N tasks. -->

## Hooks
- [Step 3] hooks — Built 3 agent hooks in `.kiro/hooks/` (+ backing scripts in `tests/`):
  - **test-on-save** (`PostFileSave`, matcher `^(lib|tests)/.*\.ts$`) → runs `npm test` (Vitest, `vitest run`, no watch) and reports failures.
  - **copy-guard** (`PostFileSave`, matches `lib/i18n/**`, `components/**`, `app/**/*.tsx`) → runs `tests/copy-guard.mjs`: flags forbidden phrases in EN/ES/PT/HT/ZH and English copy above 8th-grade reading level. Dependency-free; grades only real sentences (≥8 words, ends in punctuation) to avoid false positives on short UI labels; exempts the fixed disclaimer.
  - **update-docs** (manual, `UserPromptSubmit` matcher "update docs") → `tests/update-docs.mjs`: appends a dated entry to KIRO_LOG.md and refreshes the README "How we used Kiro" section.
- [Step 3] hook:copy-guard TEST — Wrote a scratch file with the forbidden phrase "you qualify for this trial"; copy-guard flagged it and exited 2:
  `[forbidden:en] "you qualify" in tests/scratch-copy.ts -> Good news — you qualify for this trial.`
  Also verified Spanish detection (`[forbidden:es] "usted califica"`). Reverted the scratch file. **(screenshot this firing for the demo video.)**
- [Step 3] hook:copy-guard FINDING — Running copy-guard on the real `lib/i18n/en.ts` flagged one legit over-limit string (grade 8.4 > 8): `results.tryWider` "Try a larger distance, or a more general word (for example \"diabetes\" instead of \"type 2 diabetes\")." Flagged to Neil (owner of i18n) to simplify — not editing his file directly per ownership rules.

## MCP
<!-- e.g. - [time] mcp:fetch — probed ClinicalTrials.gov live to confirm eligibilityModule field shape before writing the parser. -->

## Property-based tests (fast-check)
<!-- e.g. - [time] pbt:quickCheck — property "never returns eligible" caught a branch that returned 'eligible' for empty criteria. -->

## Kiro tools / Crew / Powers
<!-- e.g. - [time] crew — ran fit-check and getting-there spec tasks in parallel. -->
