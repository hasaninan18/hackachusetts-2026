# KIRO_LOG

A running log of how we used Kiro to build TrialPath MA. One line per meaningful thing Kiro did for us — this feeds the hackathon write-up and the demo video's "how we built it" section.

Format: `- [time] <area> — what Kiro did / what it caught / why it mattered`

## Steering
- [pre-11:30] steering — Created `.kiro/steering/{safety,product,tech,structure}.md` + `KIRO_LOG.md` with Kiro. `safety.md` encodes the non-negotiables (never claim eligibility, ≤ 8th-grade reading level, health answers stay in the browser, always show contact + disclaimer, preserve NCT/phone/email in translation). Everything else references these rules so generated copy and code inherit the guardrails. Shipped as PR #1.
- [pre-11:30] steering (review round) — Hasan reviewed; tightened per feedback: replaced the toothless "never returns eligible" property (the TS union already guarantees it) with behavioral invariants (quickCheck monotonicity, out-of-range age → may-rule-out, empty/malformed text → never possible-fit, parseAge handles "6 Months"/"N/A"/"No maximum"/junk). Added a single-canonical-unit rule (km in lib/, convert at edges) to kill the miles/degrees mismatch. Made the forbidden-phrase list multilingual + run the hook on cached translations. Narrowed demo languages to EN/ES/PT/HT and resolved the "Chinese" ambiguity (label Simplified-Mandarin or Traditional-Cantonese if added). Added accessibility + empty/error-state rules to structure.md. Flagged the Bedrock region/inference-profile claims as "verify in AWS."

## Specs
<!-- e.g. - [time] spec:trial-search — generated EARS requirements; design; N tasks. -->

## Hooks
<!-- e.g. - [time] hook:reading-level — flagged a trial summary at grade 11; rewrote to grade 7. -->

## MCP
<!-- e.g. - [time] mcp:fetch — probed ClinicalTrials.gov live to confirm eligibilityModule field shape before writing the parser. -->

## Property-based tests (fast-check)
<!-- e.g. - [time] pbt:quickCheck — property "never returns eligible" caught a branch that returned 'eligible' for empty criteria. -->

## Kiro tools / Crew / Powers
<!-- e.g. - [time] crew — ran fit-check and getting-there spec tasks in parallel. -->
