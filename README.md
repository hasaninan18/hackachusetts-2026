# TrialPath MA

**Hackachusetts 2026 · Healthcare & Biotech track (H5: Making clinical research more accessible)**

3,145 clinical trials are recruiting at Massachusetts sites right now. Finding one means reading dense medical eligibility text, usually only in English, with no idea how to get there. **TrialPath turns any recruiting MA trial into a plain-language, multilingual "might this fit me?" checklist, then shows how to reach the site by the T — including whether the nearest stop is wheelchair accessible.** It never says "you're eligible"; it gets people to a confident conversation with the study team.

**Team:** Hasan (@hasaninan18) · Neil (@neil066) · Akash (@akashmishra042006-lgtm)

## Features (MVP)
- Search recruiting MA trials by condition + ZIP / location, nearest first
- Plain-language trial card (~8th-grade reading level)
- "Might this fit me?" quick-check: structured age/sex/healthy-volunteer checks + simple yes/no questions from the eligibility text
- Getting there: nearest MBTA stops, wheelchair accessibility, transit directions link
- 6 languages: English, Spanish, Portuguese, Haitian Creole, Chinese, Vietnamese
- Contact the study team + printable summary for your doctor

## Data
- [ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) — recruiting studies, eligibility, site locations
- [MBTA V3 API](https://api-v3.mbta.com/) — stops near each site, wheelchair boarding
- Amazon Bedrock — plain-language rewriting, question generation, translation

## Team plan
👉 **Full plan, roles, timeline, and Kiro prompts: [docs/PLAN.md](docs/PLAN.md)**

## Run it
_TBD_

## Demo
- Live demo: _TBD_
- Video (<3 min): _TBD_

## How we used Kiro
_Specs, steering, hooks, MCP, property-based tests, powers, Kiro tools used (IDE / CLI / Web / Crew)._

> TrialPath is not medical advice. The study team decides eligibility.
