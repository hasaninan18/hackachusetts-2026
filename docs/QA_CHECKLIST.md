# QA Checklist — TrialPath MA

Hand-check before the demo. Grounded in `.kiro/steering/safety.md` (never claim eligibility, ≤ 8th
grade, identifiers verbatim, disclaimer + contact always shown) and `docs/` product scope
(English, Spanish, Portuguese, Haitian Creole, Simplified Chinese; transit + accessibility).

How to use: work top to bottom on the live Vercel URL. For anything that fails, file it in the
hand-check table (§1) or note it under the relevant checklist. A section is done only when every
box is ticked **or** has a written note explaining why it was skipped.

---

## 1. 15-trial eligibility hand-check

Pick 15 recruiting MA trials (include the 5–10 used in the demo video, plus a few with messy,
long, or sparse eligibility text). For each, read the trial's **original** eligibility criteria on
ClinicalTrials.gov, then compare against the app's generated quick-check questions.

- **Accurate (yes/no)** — do the generated questions faithfully reflect the original criteria,
  without changing who would be ruled out?
- **Error type** — if not accurate, which failure:
  - *dropped exclusion* — a real exclusion criterion is missing from the questions.
  - *invented criterion* — a question asks about something not in the original text.
  - *wrong age* — the age bound shown/asked does not match the original min/max age.
- Leave rows blank now; fill during the hand-check.

| # | NCT ID | Summary of original eligibility text | Generated questions | Accurate (yes/no) | Error type (dropped exclusion / invented criterion / wrong age) | Notes |
|---|--------|--------------------------------------|---------------------|-------------------|------------------------------------------------------------------|-------|
| 1  |  |  |  |  |  |  |
| 2  |  |  |  |  |  |  |
| 3  |  |  |  |  |  |  |
| 4  |  |  |  |  |  |  |
| 5  |  |  |  |  |  |  |
| 6  |  |  |  |  |  |  |
| 7  |  |  |  |  |  |  |
| 8  |  |  |  |  |  |  |
| 9  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |
| 11 |  |  |  |  |  |  |
| 12 |  |  |  |  |  |  |
| 13 |  |  |  |  |  |  |
| 14 |  |  |  |  |  |  |
| 15 |  |  |  |  |  |  |

Roll-up (fill after the table):
- Trials checked: ____ / 15
- Accurate: ____   Inaccurate: ____
- Dropped exclusions: ____   Invented criteria: ____   Wrong age: ____
- Any inaccuracy that could read as reassurance (e.g. a dropped exclusion that makes a person look
  like a fit) must be fixed or the trial pulled from the demo.

---

## 2. Live URL — device & network

Run the live Vercel URL end to end (search → results → trial → quick-check → getting there →
contact) in each context.

### 2a. On a phone (real handset, not just a narrow browser)
- [ ] Opens on the live URL over cellular data.
- [ ] Search form is usable one-handed; inputs don't zoom awkwardly on focus.
- [ ] "Use my location" prompts for permission and works; ZIP entry works as a fallback.
- [ ] Results, trial card, quick-check, getting-there, and contact all render without horizontal
      scroll or clipped text.
- [ ] Google Maps directions deep link opens the Maps app / tab.
- [ ] `tel:` and `mailto:` links on the contact card open the dialer / mail app.

### 2b. Incognito / private window
- [ ] Loads with no prior cache or stored permissions.
- [ ] Location permission re-prompts (no leaked prior grant).
- [ ] Full flow works with nothing persisted between sessions.
- [ ] No console errors that only appear without cache.

### 2c. Venue Wi-Fi (test on the actual judging network if possible, or a throttled/slow connection)
- [ ] Site loads within a reasonable time on the venue network.
- [ ] Pre-warmed demo trials open fast (cache hit) even if live APIs are slow.
- [ ] If an external API is rate-limited/slow, the app degrades gracefully (see §4) instead of
      hanging.
- [ ] Have a backup: phone hotspot ready in case venue Wi-Fi blocks an API.

---

## 3. Languages — native-speaker read

Switch the language toggle and read the plain-language card + quick-check questions in each
language. Confirm a **native speaker** reads each non-English language for fluency and safety
(not just that text appears). The Chinese option must be labelled **Simplified Chinese**, never a
generic "Chinese".

For every language, confirm: the card and questions are actually in that language (not English
fallback), reads naturally, stays at a plain reading level, and the machine-translated label is
shown (non-English only).

- [ ] **English (en)** — source copy, ≤ 8th-grade reading level; no machine-translated label.
- [ ] **Spanish (es)** — native-speaker read: fluent, plain, no awkward machine artifacts; label shown.
- [ ] **Portuguese (pt)** — native-speaker read; label shown.
- [ ] **Haitian Creole (ht)** — native-speaker read; label shown.
- [ ] **Simplified Chinese (zh)** — native-speaker read; toggle labelled "Simplified Chinese";
      `<html lang>` is `zh-Hans`; label shown.
- [ ] Each non-English view shows the **machine-translated** notice.
- [ ] Switching language does not break layout, lose the selected trial, or reset the search.

---

## 4. Empty & error states

Force each state (bad ZIP / huge distance off, disconnect, throttle, etc.) and confirm the copy is
plain, friendly, ≤ 8th grade, and obeys safety.md. No raw stack traces or blank panels.

### 4a. No trials found
- [ ] Shows a plain-language "no recruiting trials near you" message, not an empty list.
- [ ] Offers a widen-radius / try-a-more-general-term action.
- [ ] Copy is ≤ 8th grade and has no forbidden phrase.

### 4b. No nearby transit stop
- [ ] Shows "no train or bus stop is close by" instead of an empty list.
- [ ] Still shows the Google Maps directions link (driving/transit), not just transit.

### 4c. API rate limit / timeout / fetch failure
- [ ] Shows a friendly retry message, not a stack trace.
- [ ] Falls back to cached / pre-warmed data for demo trials where available.
- [ ] A retry action is present and works once the network recovers.

### 4d. LLM (translation / simplify) failure
- [ ] The trial view is NOT blocked by the LLM failing.
- [ ] Falls back to the structured quick-check only (age / sex / healthy-volunteer) and/or the
      English card; skips generated questions gracefully.
- [ ] Fallback copy is plain and obeys safety.md (no forbidden phrase, no eligibility claim).

### 4e. Loading
- [ ] Loading states show skeletons/spinners with accessible `aria-busy`.
- [ ] No result or partial result flashes before data is ready.

---

## 5. Accessibility — keyboard & screen reader

Test with keyboard only, then with a screen reader (VoiceOver / NVDA / TalkBack).

### 5a. Keyboard
- [ ] Every interactive control is reachable by Tab in a logical order; nothing is keyboard-trapped.
- [ ] Visible focus indicator on every focusable element.
- [ ] Skip-to-main-content link works.
- [ ] Modals/dialogs (if any) don't trap focus and close with Esc.
- [ ] Forms submit and radio/select groups operate with the keyboard.

### 5b. Contrast & visual
- [ ] Text and interactive elements meet WCAG AA contrast.
- [ ] No information is conveyed by color alone (e.g. the "ask-team" caution is not red-only).
- [ ] Respects `prefers-reduced-motion` (no essential motion-only cues).

### 5c. Tap targets
- [ ] All tap targets are at least 44×44 px (buttons, toggles, radios, language picker, links).

### 5d. Icons & labels
- [ ] Wheelchair / accessible-stop icon has screen-reader text, e.g. `aria-label="Wheelchair
      accessible stop"` vs. `"Accessibility unknown"` — never a bare icon.
- [ ] Every form control has a label.
- [ ] Line/route chips and other icon-only elements have accessible names.

### 5e. Screen-reader read-through
- [ ] A full flow (search → trial → quick-check → getting there → contact) is understandable by
      ear, including the quick-check result and reasons announced via a status region.
- [ ] Question text in a different language from the UI is marked with its own `lang`.

---

## 6. Safety checks (non-negotiable — safety.md)

> Gaps in this section were surfaced by a read-only **Kiro Crew** review of this checklist against
> `.kiro/steering/safety.md` (see `KIRO_LOG.md`). No files were edited by that review.

Run against **every** language, not just English. Use the copy-guard checker as a backstop
(`node tests/copy-guard.mjs lib/i18n/en.ts lib/i18n/es.ts lib/i18n/pt.ts lib/i18n/ht.ts lib/i18n/zh.ts lib/i18n/vi.ts`)
AND eyeball the live UI, including the cached translations.

### 6a. Never claim eligibility
- [ ] No "you are eligible", "you qualify", "you're a match", "you have been accepted", "you meet
      the criteria", "guaranteed", or "approved for this trial" anywhere — in the card, questions,
      buttons, results, reasons, errors, or tooltips.
- [ ] Non-English equivalents absent too (safety.md §1 list): ES "usted califica / usted es elegible
      / cumple los requisitos"; PT "você se qualifica / você é elegível / atende aos critérios";
      HT "ou kalifye / ou elijib"; ZH "您符合条件 / 您符合资格 / 您合格".
- [ ] **Vietnamese (VI) equivalents absent too** (safety.md §1, machine-drafted — pending a
      Vietnamese speaker's review): "bạn đủ điều kiện", "bạn đủ tiêu chuẩn", "bạn phù hợp", "bạn đáp
      ứng các tiêu chí", "được bảo đảm".
- [ ] Quick-check **outcome wording is checked in every shipped language** (EN/ES/PT/HT/ZH, plus VI
      if it ships), and matches **whichever outcome set the team ships** — the two-outcome set
      ("possible fit — contact the study team" / "some answers may rule you out — ask the study
      team") or, if adopted, the three-outcome set that adds "not sure — the study team can tell
      you". Never any wording that implies the user is eligible.
- [ ] The forbidden-phrase check was run on the **cached translations**, not just the English source.
- [ ] **New-language gate:** before any new language ships, its forbidden-phrase equivalents exist
      in `safety.md` §1 (and in `tests/copy-guard.mjs`). A language is not demoed until this is done.

### 6a-bis. Plain language (safety.md §2)
- [ ] The **main trial card** (what it studies / what you'd do / time) and the **quick-check
      questions** read at **≤ 8th-grade reading level** — short sentences, common words, medical
      terms explained in plain words. Check the English source; copy-guard grades the English prose.

### 6b. Disclaimer present
- [ ] Every trial view shows exactly: "TrialPath is not medical advice. The study team decides
      eligibility."
- [ ] The disclaimer is present in each language view.

### 6c. Contact present
- [ ] Every trial view shows the study's central or site contact from the API.
- [ ] When a trial lists no contact, the view says so and points to ClinicalTrials.gov instead of
      showing a blank.

### 6c-bis. Contact + disclaimer on non-trial pages
- [ ] The **disclaimer** ("TrialPath is not medical advice. The study team decides eligibility.")
      is present on **non-trial pages too** — the search page, the results list, and the empty /
      error states — not only on a trial view.
- [ ] Guidance to **contact the study team** is reachable from those non-trial pages (or the page
      makes clear the study team decides), so the "study team decides" framing is never dropped.

### 6d. Identifiers verbatim
- [ ] NCT IDs appear byte-for-byte identical across all languages (no translation/reformat).
- [ ] Phone numbers appear byte-for-byte identical across all languages; the `tel:` link dials the
      same number in every language.
- [ ] Email addresses appear byte-for-byte identical across all languages; the `mailto:` link is
      unchanged.

### 6e. Privacy
- [ ] Quick-check answers never leave the browser (no network request carries them; nothing is
      stored). Spot-check the Network tab while answering.
- [ ] **Quick-check answers are never logged server-side** — no route handler, analytics, or server
      log records the user's age / sex / healthy-volunteer / question answers.
- [ ] Only the search query (condition + location + distance) is sent to external APIs.

### 6f. Scope boundaries (safety.md §5/§6)
- [ ] **Ranking is by distance and factual filters only** (recruiting status, location) — never by
      anything implying medical suitability or a likelihood of fitting.
- [ ] **No diagnosis or treatment advice** anywhere: the app does not diagnose, recommend treatment,
      or interpret medical results, in any language.
- [ ] **Unclear or borderline copy defaults to the cautious "contact the study team" framing** — if
      wording could be read as an eligibility judgement, it is reworded to point at the study team.

---

## Sign-off

- [ ] §1 hand-check complete (15 / 15 or noted)
- [ ] §2 device & network complete
- [ ] §3 all five languages read by a native speaker
- [ ] §4 empty & error states complete
- [ ] §5 accessibility complete
- [ ] §6 safety checks complete

Checked by: ______________   Date: ____________   Live URL: ______________________________
