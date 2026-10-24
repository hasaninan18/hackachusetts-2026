# TrialPath MA

**Hackachusetts 2026 · Healthcare & Biotech track (H5: Making clinical research more accessible)**

3,145 clinical trials are recruiting at Massachusetts sites right now. Finding one means reading dense medical eligibility text, usually only in English, with no idea how to get there. **TrialPath turns any recruiting MA trial into a plain-language, multilingual "might this fit me?" checklist, then shows how to reach the site by the T — including whether the nearest stop is wheelchair accessible.** It never says "you're eligible"; it gets people to a confident conversation with the study team.

**Team:** Hasan (@hasaninan18) · Neil (@neil066) · Akash (@akashmishra042006-lgtm)

## Live demo
- **App:** https://trialpath-ma.vercel.app (try `/es`, search **"diabetes tipo 2"** near ZIP **02122**, open the Boston Medical Center study NCT07043426)
- **Video (<3 min):** linked in our SundAI submission

## Features
- **Search** recruiting Massachusetts trials by condition + ZIP or location, nearest first, within 5/10/25 mi. Corrects ClinicalTrials.gov's shared Boston city-center coordinates to real hospital locations (BMC, Brigham, BIDMC, MGH, Boston Children's) so distances and transit are right.
- **Search in your language:** condition names in Spanish, Portuguese and Haitian Creole ("diabetes tipo 2", "asma", "presión alta", "tansyon wo") map to the English registry terms with a fixed, reviewed word list (no AI).
- **Results and study pages in your language:** study titles, conditions and a plain-language summary are machine-translated (Amazon Nova on Bedrock), labeled "Traducción automática / Resumen automático", with the original English always shown. Drug codes, numbers, site names and contacts are preserved; comparison groups are described only as the registry states them (placebo vs. usual care). Falls back to English if translation fails.
- **"Might this fit me?"** checklist: structured age checks plus yes/no questions built server-side **only from reviewed, study-pinned criteria** (currently NCT07043426, EN/ES). Altered, negated or unreviewed criteria produce no question; the app says "Not sure yet — ask the study team" instead of guessing. It never says "eligible".
- **Getting there:** up to 3 nearest MBTA stops with wheelchair accessibility, walking distance, transit and driving directions.
- **Contact the study team** + print/share (share links drop the user's condition and location). Answers never leave the browser.
- UI in English, Español, Português, Kreyòl ayisyen, 中文, Tiếng Việt.

## Data
- [ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) — recruiting studies, eligibility, site locations
- [MBTA V3 API](https://api-v3.mbta.com/) — stops near each site, wheelchair boarding
- Amazon Bedrock (us-east-2) — Amazon Nova 2 Lite (fallback Nova Pro) for plain-language summaries and translation

## Run it
```bash
npm ci
# .env.local (not committed): AWS_BEARER_TOKEN_BEDROCK, AWS_REGION=us-east-2,
#   BEDROCK_MODEL_ID=us.amazon.nova-2-lite-v1:0, BEDROCK_FALLBACK_MODEL_ID=us.amazon.nova-pro-v1:0
npm run dev        # http://localhost:3000
npm test           # Vitest + fast-check (unit + property-based tests)
npm run typecheck && npm run lint && npm run build
```
Search, transit and the English UI work without AWS credentials; translation and summaries need Bedrock.

## Known limits
- Yes/no questions exist only for reviewed criteria (NCT07043426, English/Spanish); other studies get the "ask the study team" path.
- Translations are machine-generated and labeled; no native-speaker, screen-reader or real-phone review has been done yet.
- Not medical advice. The study team decides eligibility.

## Team plan
Tasks and prompts: [docs/TASKS.md](docs/TASKS.md) · Plan: [docs/PLAN.md](docs/PLAN.md) · Demo data and prompt rules: [docs/DEMO_DATA.md](docs/DEMO_DATA.md)

## How we used Kiro

Full detail: **[docs/KIRO_WRITEUP.md](docs/KIRO_WRITEUP.md)**. Claims below are grounded in
`KIRO_LOG.md`, `docs/TASKS.md`, the files in `.kiro/`, and the merged `main` branch.

- **Kiro tools (IDE, CLI, Web, Crew).** An earlier **Kiro Web** session authored the **steering**
  and **hooks**; the later **Kiro IDE** session authored the **specs, property tests, MCP probes,
  the Context7 review, and the CLI run**. The **Kiro CLI** (`kiro-cli.exe`, 2.34.0) ran
  `npx vitest run` with no edits in 23s and reported, **at that time**, 62 tests / 57 passed / 5
  failed (the empty translation dictionaries) — fixed on `main`. The `kiro` command is the IDE
  launcher. **Kiro Crew:** two read-only Crew review sessions, run sequentially, no files edited
  (per `KIRO_LOG.md`).
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
