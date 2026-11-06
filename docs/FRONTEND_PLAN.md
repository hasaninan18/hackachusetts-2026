# TrialPath MA — Frontend Plan (Neil)
Companion to [PLAN.md](PLAN.md). Covers MVP items 1–6 from the user's side: screens, components, the data contract with Hasan's routes, and build order.

## 1. Screens
| Route | Purpose | Key pieces |
|---|---|---|
| `/` | Search | Condition input · ZIP input **or** "Use my location" · distance 5 / 10 / 25 mi · Search button |
| `/results?cond=&lat=&lon=&radius=` | Trial list, nearest first | `TrialListItem` per trial: plain title, condition, phase, nearest site + town, distance · loading skeleton · empty state ("No recruiting trials within N mi — try 25 mi") |
| `/trial/[nct]?lang=` | One trial | Plain-language card → Quick check → Getting there → Contact the team → Print summary |

The header on every page has the language picker (EN / ES / PT / HT / ZH / VI) and the disclaimer footer: "TrialPath is not medical advice. The study team decides eligibility."

Language is stored in `?lang=` (so shared links keep it) and mirrored to `localStorage`.

## 2. Components
```
app/
  layout.tsx            Header (LanguagePicker) + Footer (Disclaimer)
  page.tsx              SearchForm
  results/page.tsx      ResultsList → TrialListItem[]
  trial/[nct]/page.tsx  PlainCard · QuickCheck · GettingThere · ContactCard · PrintButton
components/
  SearchForm.tsx        condition, ZIP/geolocation, radius; validates MA ZIP (010xx–027xx)
  TrialListItem.tsx
  PlainCard.tsx         what it studies / what you'd do / time commitment
  QuickCheck.tsx        structured checks (instant) + LLM yes/no/not-sure questions → FitResult
  FitResult.tsx         only two outcomes, see §4
  GettingThere.tsx      StopRow[] (name, line color chips, ♿ yes/no/unknown, walk distance) + transit link
  ContactCard.tsx       name / phone (tel:) / email (mailto:)
  LanguagePicker.tsx
  Disclaimer.tsx
lib/
  i18n/strings.ts       UI chrome strings × 6 languages (trial content comes from /api/simplify)
  mock/                 fixture JSON matching the contract below (build UI before the API exists)
  types.ts              shared with backend, see §3
```

## 3. Data contract with backend (agree with Hasan at 11:30, lives in `lib/types.ts`)
```ts
type Sex = "ALL" | "FEMALE" | "MALE";

interface Site { name: string; city: string; lat: number; lon: number; }

interface TrialSummary {             // GET /api/trials?cond=&lat=&lon=&radius=
  nctId: string; title: string; conditions: string[]; phase: string | null;
  nearestSite: Site; distanceMi: number;
}

interface Eligibility {
  minAgeYears: number | null; maxAgeYears: number | null;
  sex: Sex; healthyVolunteers: boolean; criteriaText: string;
}

interface Stop {
  id: string; name: string; routeType: 0 | 1 | 2 | 3;   // 0 tram (Green), 1 subway, 2 commuter rail, 3 bus
  lines: { name: string; color: string }[];
  wheelchair: boolean | null;                        // MBTA wheelchair_boarding 1 → true, 2 → false, 0 → null
  walkMi: number;
}

interface Contact { name?: string; phone?: string; email?: string; }

interface TrialDetail extends TrialSummary {       // GET /api/trials/[nct]
  briefSummary: string; eligibility: Eligibility;
  sites: Site[]; contacts: Contact[]; stops: Stop[];
}

type Lang = "en" | "es" | "pt" | "ht" | "zh" | "vi";

interface Simplified {                             // POST /api/simplify { nctId, lang }
  lang: Lang;
  whatItStudies: string; whatYouDo: string; timeCommitment: string;
  questions: { id: string; text: string; ruleOutIf: "yes" | "no" }[];  // 3–6
}
```
**Live-API findings the backend needs (city-level coordinates, site status, duplicate MBTA platforms):** [BACKEND_NOTES.md](BACKEND_NOTES.md).

**Open questions for the team:** who owns ZIP→lat/lon (static MA ZCTA JSON)? Who owns `quickCheck()` in `lib/` (frontend calls it; Akash property-tests it)? Who runs `create-next-app` (proposal: Neil, pushed by 11:45 so nobody else scaffolds)?

## 4. Quick check rules (safety, matches `safety.md`)
- Profile = age, sex, healthy volunteer y/n, plus answers to the questions. **Never leaves the browser.**
- Structured mismatch (age out of range, sex mismatch) **or** any answer equal to `ruleOutIf` → "Some answers may rule you out — ask the study team."
- Otherwise → "This may be a possible fit — contact the study team."
- "Not sure" never rules anyone out. There is no third outcome, and the words "eligible" and "qualify" never appear in the UI.

## 5. Getting there
- Show up to 3 stops sorted by `walkMi`, with line color chips and ♿ ✅ / ❌ / "unknown".
- Transit link: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>&travelmode=transit` (adds `origin=` when we have the user's location).

## 6. Quality bar
- Mobile first (demo persona Maria is on a phone); test at 375 px.
- Accessibility: labels on every input, visible focus, AA contrast, `lang` attribute set per language, ♿ never shown by icon alone (text too).
- Print: `@media print` hides header and controls and shows the plain card, the quick-check answers, the contact and the NCT ID.
- Chinese needs a CJK-capable font stack. Haitian Creole and Vietnamese diacritics need checking.

## 6b. Design direction
- **Purpose:** one job per screen: find, understand, decide whether to call. **Audience:** a worried adult on a phone, often reading in a second language. **Tone:** calm, plain and practical, like civic signage, not a startup landing page.
- **Signature detail:** MBTA line chips in the official line colors (Red `#DA291C`, Orange `#ED8B00`, Green `#00843D`, Blue `#003DA5`, Silver `#7C878E`, Commuter Rail `#80276C`, Bus `#FFC72C`). They're the only saturated color on the page. A chip is ink text on white with a 12 px line-color square in front, **not** text on the line color: white text fails AA on Orange (2.53:1) and on Silver (3.68:1), and ink on Silver is 4.24:1.
- **Tokens** (CSS variables in `globals.css`, Tailwind `theme.extend`; contrast ratios measured): `--ink #1B2433` (14.7:1 on paper) · `--muted #4A5568` (7.1:1) · `--paper #FAF8F4` · `--card #FFFFFF` · `--line #E2DED6` · `--primary #0B6E69` (teal, 5.74:1 on paper, white on teal 6.09:1) · `--fit #1E6B3A` + `--fit-bg #E7F4EC` · `--ask #8A4B00` + `--ask-bg #FDF1E1` (amber, **never red**: "ask the team" isn't a failure) · `--focus #1A56DB` 3 px outline.
- **Type:** Noto Sans (Latin and Vietnamese) + Noto Sans SC (Chinese), bundled through pinned Fontsource packages, falling back to the system font. Fonts are served locally; builds do not fetch from Google Fonts. Body 17 px, line-height 1.6, max line length 65 characters. No all-caps.
- **Layout:** one column, max width 640 px, 16 px gutters, touch targets ≥ 44 px, flat sections separated by hairlines (no cards inside cards).
- **Motion:** none beyond the skeleton shimmer, which is off under `prefers-reduced-motion`.

## 7. Build order (maps to PLAN.md §6)
| Time | Work |
|---|---|
| 11:30–12:15 | Scaffold Next.js + Tailwind, `lib/types.ts`, mock fixtures (2 trials, diabetes / Dorchester), push so the team builds on it |
| 12:15–2:00 | Search page → results list → trial page shell, all on mocks |
| 2:00–4:00 | QuickCheck + FitResult, LanguagePicker + strings, GettingThere, ContactCard · swap mocks for real routes as Hasan lands them |
| 4:00–5:00 | Mobile pass, a11y pass, print view, demo-path polish · **freeze 5:00** |
| 5:00–7:15 | Screenshots for README/submission, help record the Maria walkthrough |

## 8. Tooling: who does what
Kiro is a third of the score, so the main feature code goes through Kiro and the Claude Code agents support it.

| Step | Tool | Model / effort |
|---|---|---|
| Scaffold, `types.ts`, mocks, layout, i18n skeleton | Kiro CLI (`kiro-cli chat --no-interactive`), driven from Claude Code, committed | Kiro default |
| Search + results | Kiro spec task from `trial-search` | Kiro |
| Quick check + FitResult | Kiro spec task from `fit-check` (Kiro Crew in parallel with getting-there) | Kiro |
| Getting there + Contact + Print | Kiro spec task from `getting-there` | Kiro |
| Six-language UI strings | Kiro CLI first draft, then a Claude Code agent checks that placeholders, NCT IDs and phone numbers survived | Sonnet |
| Visual direction / Tailwind tokens before building | `frontend-design-direction` skill | — |
| Review after each feature lands | `react-reviewer` + `typescript-reviewer` agents in parallel | Opus |
| Accessibility pass (4:00) | `a11y-architect` agent + `frontend-a11y` skill | Opus |
| Safety-copy check | Grep for "eligible" / "qualify" across `app/` + `components/` + `lib/i18n` (backs up Akash's hook) | — |
| Build breaks | `react-build-resolver` agent | Sonnet |
| Demo-path test on the Vercel preview link | `e2e-runner` agent (Maria: diabetes, 02124, Spanish → fit result → accessible stop → print) | Sonnet |
| Before freeze | `/code-review high` on the frontend diff | — |

All commits go on branch `neil/frontend`. Pull requests into `main` are small, one per screen, so Hasan's API routes merge cleanly.

## 9. Before 11:30
- [ ] Accept the GitHub repo invite (`neil066`), clone, open in the Kiro IDE, push a test commit
- [ ] Install Kiro CLI, `kiro-cli login`, `kiro-cli whoami`
- [ ] Node 22 ✓, npm 11 ✓ (checked)
- [ ] Sketch the 3 screens (§10). Agree on §3 types with Hasan and the open questions with the team.

## 10. Wireframes (phone, 375 px)
```
 /  Search                    /results                      /trial/[nct]
┌───────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
│ TrialPath MA   [ES ▾] │   │ ← 12 trials · 10 mi   │   │ ← Back         [ES ▾] │
│                       │   │ ┌───────────────────┐ │   │ Type 2 Diabetes study │
│ Find a clinical study │   │ │ Diabetes · Ph 2   │ │   │ NCT01234567           │
│ near you              │   │ │ Study title…      │ │   │ ┌ What it studies ──┐ │
│ What condition?       │   │ │ BMC, Boston·1.2mi │ │   │ │ What you'd do     │ │
│ [ type 2 diabetes   ] │   │ └───────────────────┘ │   │ │ Time commitment   │ │
│ Where?                │   │ ┌───────────────────┐ │   │ └───────────────────┘ │
│ [ 02124 ] [📍 Use my  │   │ │ …                 │ │   │ Might this fit me?    │
│           location]   │   │ └───────────────────┘ │   │ Age [  ] Sex [▾]      │
│ How far? (5)(10)(25)  │   │ [Try 25 mi] (empty)   │   │ Q1 (Yes)(No)(Not sure)│
│ [      Search       ] │   │                       │   │ → FitResult box       │
│ not medical advice    │   │ not medical advice    │   │ Getting there         │
└───────────────────────┘   └───────────────────────┘   │ Ashmont · Red ♿ Yes  │
                                                        │ [Transit directions]  │
                                                        │ Contact the team      │
                                                        │ [Call] [Email] [Print]│
                                                        └───────────────────────┘
```

## 11. Data flow
- **ZIP → lat/lon in `SearchForm`** (client side, using the static MA ZIP JSON) before navigating. So `/results` always gets `lat`/`lon`, and a ZIP that isn't in the JSON shows an inline error without leaving the page.
- **`/results` and `/trial/[nct]` are server components** that call Hasan's `lib/` fetch functions directly (no extra HTTP hop). With `?mock=1` they read `lib/mock/` instead, which keeps the frontend unblocked and is the backup if the demo API goes down.
- **`/api/simplify` is fetched client side** from the trial page, so facts, stops and contacts render right away and the plain-language card fills in after.
- **Results list language:** titles and conditions stay in English, with a small "Study titles are in English" note when the language isn't EN. Simplifying happens only on the trial page, which keeps model calls down and the cache small.

## 12. States
| Where | Loading | Empty / error |
|---|---|---|
| Search | Geolocation spinner on the button | Location denied → "Type your ZIP instead" · non-MA or unknown ZIP → inline error |
| Results | Skeleton cards (`loading.tsx`) | 0 results → suggest 25 mi or a broader condition · API error → retry button |
| Plain card | Skeleton text lines | Model failed or timed out (10 s) → show the official `briefSummary` with "Plain-language version unavailable" |
| Quick check | Structured checks show instantly; question rows are skeletons | No questions → structured checks only, plus "Ask the study team about the full list" |
| Getting there | — | No stop within ~0.7 mi → "No T stop nearby", still show the directions link |
| Contact | — | No contacts → link to `https://clinicaltrials.gov/study/<NCT>` |
| Unknown NCT | — | `not-found.tsx` → back to search |

## 13. Kiro prompts for Neil's tasks (if Akash's specs aren't ready by 12:15)
**F1 — scaffold:** "In this repo, create a Next.js App Router + TypeScript + Tailwind app at the root (don't touch `docs/` or `.kiro/`). Add `lib/types.ts` exactly as in `docs/FRONTEND_PLAN.md` §3, and `lib/mock/` with 2 recruiting type 2 diabetes trials near Dorchester (02124), with realistic eligibility, 2 MBTA stops each (one accessible, one not) and a Spanish `Simplified`. Add `app/layout.tsx` with a header (language picker placeholder) and a footer with the disclaimer. Follow the steering docs."

**F2 — search + results:** "Build `/` and `/results` per `docs/FRONTEND_PLAN.md` §1, §10–12: SearchForm with condition, MA ZIP or geolocation, radius 5/10/25; results as a server component reading mocks when `?mock=1`; loading skeleton, empty and error states. Mobile first, labelled inputs, visible focus."

**F3 — trial page:** "Build `/trial/[nct]` per `docs/FRONTEND_PLAN.md` §1, §4, §5, §12: PlainCard (fills client side from `/api/simplify`, with a briefSummary fallback), QuickCheck + FitResult following §4 exactly, GettingThere, ContactCard, print styles. The words 'eligible' and 'qualify' must never appear."

**F4 — i18n:** "Create `lib/i18n/strings.ts` with every UI string from `app/` and `components/` in en, es, pt, ht, zh, vi, and a `t(key, lang)` helper. Keep `{placeholders}` intact. Set `<html lang>` from `?lang=`."

## 14. Done checks (per screen, before its PR)
- Works at 375 px and on desktop · keyboard-only path works · no console errors
- Works with `?mock=1` and against the real API
- `grep -riE "eligible|qualif" app components lib/i18n` → only in the disclaimer
- Switching language changes every visible UI string

## 15. Cut list if behind (cut in this order)
1. Print view → the browser's own print is enough
2. "Use my location" → ZIP only
3. Desktop polish → phone layout only (the demo is on a phone)
4. Live languages beyond ES → keep all 6 in the picker, pre-warm only the demo trial in ES

**Never cut:** the quick-check safety wording, the disclaimer, the ES demo path, the accessible-stop display.

## 16. Follow-up to Neil's committed frontend (2026-10-24)

The search/results/detail screens, quick check, transit, contacts, print controls, and accessibility fixes already exist on main in Neil's commits `7a0f458`, `3cd409a`, and `cdd898d`. Do not rebuild them merely because the earlier task checklist says “scaffold.” Neil authorized this follow-up in Codex; it is not evidence of Kiro usage.

This follow-up fills the previously empty UI dictionaries for Spanish, Portuguese, Haitian Creole, Simplified Chinese, and Vietnamese, and adds the reported-results section requested in PLAN.md. Dictionary checks cover every key, placeholders and forbidden claims. These are draft translations that still need fluent-speaker review. Registry titles, outcome measures and source text remain marked as English; mock simplified content falls back to English when that language's fixture is absent. Live trial translation remains Hasan's API work.

### Results contract for Hasan

`TrialDetailWithOutcomes` is a frontend-only extension in `lib/outcomes.ts` with an optional `outcomes` field. The frontend validates it there before display. Shared `lib/types.ts` and `lib/geo.ts` remain unchanged; existing detail responses remain compatible. Backend adoption of the optional field still requires Hasan’s review.

| Status | When to return it | Required fields |
|---|---|---|
| omitted / `not_checked` | Results integration has not run | None |
| `unavailable` | Upstream check failed or cannot be parsed safely | None |
| `not_posted` | A successful check of this study confirms no posted results | `nctId`, `checkedOn` (YYYY-MM-DD) |
| `available` | Verified results for this exact study are available | `nctId`, `postedOn` (source results posting/update date), nonempty `measures` |

Each measure requires its source `title`, `timeFrame`, `statistic`, and nonempty `groups`. Every group requires `name`, `participants` (nonnegative integer count analyzed for that specific measure), `value` (source text), and `unit`; optional `uncertainty` must include its label, such as SD or 95% CI. Do not substitute enrollment for the number analyzed. A missing comparison group or required field must make results unavailable, not silently remove the group. Preserve reported values, including zero and negative changes. Do not compute a personal success rate.

An available report may include an English `summary` and `limitations`, sourced to the registry report. It must summarize findings faithfully, including reported harms and caveats, and never invent patient quotes. The UI fixes the source link to the same NCT ID on ClinicalTrials.gov, labels the report date, and includes the source URL in print. Result text is escaped. Checklist answers do not affect results and are not sent to this endpoint.

No production outcome numbers were added to mocks. Until the backend is connected, the new section says results have not been checked. Synthetic numbers appear only in tests. A live results integration still requires checking at least one real posted-results study against the official source before release.

## 17. Optional reduced provider directory — planning only

Read [DOCTORS_REDUCED_PLAN.md](DOCTORS_REDUCED_PLAN.md), Phases 0/2/3, before implementation. This is last priority after PR #16's fallback and hero-search blockers, core integration and QA. Neil owns one shared-contract change after Hasan reviews it, then provider tab/list/link and EN/ES states in a separate Kiro worktree. Preserve the six-language trial experience with safe other-language navigation. No half-built or mock-only live feature. The 4:15 PM completion gate and 5 PM freeze apply.

The original full frontend design is reserved in [the post-competition archive](post-competition/find-a-doctor-full/frontend-plan.md); it is not a second active task list.
