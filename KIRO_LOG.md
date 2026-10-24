# KIRO_LOG

A running log of how we used Kiro to build TrialPath MA. One line per meaningful thing Kiro did for us — this feeds the hackathon write-up and the demo video's "how we built it" section.

Format: `- [time] <area> — what Kiro did / what it caught / why it mattered`

## Steering
- [pre-11:30] steering — Created `.kiro/steering/{safety,product,tech,structure}.md`. `safety.md` encodes the non-negotiables (never claim eligibility, ≤ 8th-grade reading level, health answers stay in the browser, always show contact + disclaimer, preserve NCT/phone/email in translation). Everything else references these rules so generated copy and code inherit the guardrails.

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
