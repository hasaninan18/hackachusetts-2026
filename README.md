# TrialPath MA

**Hackachusetts 2026 · Healthcare & Biotech track (H5: Making clinical research more accessible)**

3,145 clinical trials are recruiting at Massachusetts sites right now. Finding one means reading dense medical eligibility text, usually only in English, with no idea how to get there. **TrialPath turns any recruiting MA trial into a plain-language, multilingual "might this fit me?" checklist, then shows how to reach the site by the T — including whether the nearest stop is wheelchair accessible.** It never says "you're eligible"; it gets people to a confident conversation with the study team.

**Team:** Hasan (@hasaninan18) · Neil (@neil066) · Akash (@akashmishra042006-lgtm)

## Features (MVP)
- Search recruiting MA trials by condition + ZIP / location, nearest first
- Plain-language trial card (~8th-grade reading level)
- "Might this fit me?" quick-check: structured age/sex/healthy-volunteer checks + simple yes/no questions from the eligibility text
- Getting there: nearest MBTA stops, wheelchair accessibility, transit directions link
- Multilingual: English, Spanish, Portuguese, Haitian Creole, Simplified Chinese (Vietnamese stretch)
- Contact the study team + printable summary for your doctor

## Data
- [ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) — recruiting studies, eligibility, site locations
- [MBTA V3 API](https://api-v3.mbta.com/) — stops near each site, wheelchair boarding
- Amazon Bedrock — plain-language rewriting, question generation, translation

## Team plan
👉 **Start here: [docs/TASKS.md](docs/TASKS.md)** (who does what + Kiro prompts) · Full plan: [docs/PLAN.md](docs/PLAN.md)

## Run it
_TBD_

## Demo
- Live demo: _TBD_
- Video (<3 min): _TBD_

## How we used Kiro

Full detail: **[docs/KIRO_WRITEUP.md](docs/KIRO_WRITEUP.md)**. Claims below are grounded in
`KIRO_LOG.md`, `docs/TASKS.md`, the files in `.kiro/`, and the merged `main` branch.

- **Kiro tools (IDE, CLI, Web, Crew).** An earlier **Kiro Web** session authored the **steering**
  and **hooks**; the later **Kiro IDE** session authored the **specs, property tests, MCP probes,
  the Context7 review, and the CLI run**. The **Kiro CLI** (`kiro-cli.exe`, 2.34.0) ran
  `npx vitest run` with no edits in 23s and reported, **at that time**, 62 tests / 57 passed / 5
  failed (the empty translation dictionaries) — fixed on `main`. The `kiro` command is the IDE
  launcher. **Kiro Crew: TODO — no Crew run in the log.**
- **Spec-driven vs vibe coding.** Three features are spec-driven with EARS requirements and were
  written in the Kiro IDE: **fit-check**, **getting-there**, and **translation** — each with
  **requirements + design + tasks**. `trialpath-ui` is a **retrospective Codex spec**, not proof of
  spec-first Kiro development. Vibe coding: TODO — the log attributes no feature code to a vibe
  session.
- **Hooks.** **Copy guard** and **Test on save** (`PostFileSave`) each showed in the IDE as
  **triggered automatically when the agent wrote a file** (agent file writes, not manual saves;
  panel output not captured). A **manual-save observation with panel output is a remaining TODO.**
  The manual `/update-docs` steering command is distinct from the hooks. Copy guard checks
  **EN/ES/PT/HT/ZH/VI**, matches both slash styles, and runs `node tests/copy-guard.mjs`.
- **Steering.** `.kiro/steering/{safety,product,tech,structure}.md` encode the non-negotiables
  (never claim eligibility, ≤ 8th-grade copy, privacy, verbatim identifiers) that every spec and
  generated file inherits, plus the `/update-docs` manual command. The five **Vietnamese** forbidden
  phrases added to `safety.md` are **machine-drafted and need review by a Vietnamese speaker.**
- **MCP.** The `fetch` MCP server (`uvx mcp-server-fetch`) probed MBTA V3 and ClinicalTrials.gov
  v2 live to confirm real field shapes before writing parsers. CT.gov was **blocked by robots.txt**
  until `--ignore-robots-txt` was added and the server restarted.
- **Property-based testing (fast-check).** 16 properties across two files, all passing — **no
  property failed and no counterexample was found.** They document today's real contracts (e.g.
  `quickCheck` returns `possible-fit` / `ask-team`).
- **Powers.** Used the **Context7** Power to check `proxy.ts`, the `[lang]` routing, and the
  fast-check usage against current docs for the installed versions. **Context7 found no problems.**
- **Integrated snapshot:** `main` is at **178 tests passing** (179 with the Vietnamese additions),
  per `KIRO_LOG.md`. PR merges are done from the `hasaninan18` account (per `docs/TASKS.md`); that
  doesn't change who did the work. **Still pending** (per `docs/TASKS.md`): Hasan's simplify route
  (source-evidence, age validation, EN/ES verification) and Neil's cautious `quickCheck` fallback +
  remaining frontend QA — none claimed complete.

> TrialPath is not medical advice. The study team decides eligibility.
