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

Full detail: **[docs/KIRO_WRITEUP.md](docs/KIRO_WRITEUP.md)**. Every claim below is drawn from
`KIRO_LOG.md` and the files in `.kiro/`.

- **Kiro tools (IDE, CLI, Web, Crew).** We worked across sessions: an early **Kiro Web** session
  authored steering, specs, hooks, and the property tests, and a later **Kiro IDE** session
  re-created the hooks (Web had written an invalid trigger name) and ran the MCP and Powers work.
  _TODO: confirm whether Kiro CLI or Crew were used — the log records no CLI or Crew runs._
- **Spec-driven vs vibe coding.** Three features are spec-driven with EARS requirements:
  **fit-check** (requirements only), **getting-there** (requirements + design + tasks), and
  **translation** (requirements + design + tasks). Each spec is grounded in the code that exists
  and marks satisfied tasks vs. known gaps instead of inventing behavior.
- **Hooks.** Three agent hooks in `.kiro/hooks/`: **Copy guard** and **Test on save**
  (`PostFileSave`) and a **Update docs** manual hook (paired with a `/update-docs` steering
  command). The backing scripts work when run by hand; **we never confirmed a hook firing on a
  real save in the IDE.**
- **Steering.** `.kiro/steering/{safety,product,tech,structure}.md` encode the non-negotiables
  (never claim eligibility, ≤ 8th-grade copy, privacy, verbatim identifiers) that every spec and
  generated file inherits, plus the `/update-docs` manual command.
- **MCP.** The `fetch` MCP server (`uvx mcp-server-fetch`) probed MBTA V3 and ClinicalTrials.gov
  v2 live to confirm real field shapes before writing parsers. CT.gov was **blocked by robots.txt**
  until `--ignore-robots-txt` was added and the server restarted.
- **Property-based testing (fast-check).** 15 properties across two files, all passing — **no
  property failed and no counterexample was found.** They document today's real contracts (e.g.
  `quickCheck` returns `possible-fit` / `ask-team`).
- **Powers.** Used the **Context7** Power to check `proxy.ts`, the `[lang]` routing, and the
  fast-check usage against current docs for the installed versions. **Context7 found no problems.**

> TrialPath is not medical advice. The study team decides eligibility.
