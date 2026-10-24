# Safety Rules (TrialPath MA)

These rules are **non-negotiable** and override all other guidance. TrialPath helps Massachusetts residents find recruiting clinical trials. It does **not** give medical advice and **never** decides who is eligible.

## 1. Never claim eligibility
- Never state or imply that a user **is eligible**, **qualifies**, **matches**, or **is accepted** for a trial.
- The **study team decides eligibility** — always. TrialPath only helps the user reach a confident conversation with that team.
- Allowed outcome language for the "might this fit me?" quick-check (use exactly one of these intents):
  - ✅ "Looks like a **possible fit** — contact the study team."
  - ✅ "Some answers **may rule you out** — ask the study team."
  - ✅ "**Not sure** from your answers — the study team can tell you."
- **Forbidden phrases (English)**, any casing: "you are eligible", "you qualify", "you're a match", "you have been accepted", "you meet the criteria", "guaranteed", "approved for this trial".
- **Forbidden phrases apply in every supported language.** A hook can only catch phrases it knows, so the forbidden-phrase list MUST include the equivalents per language, and the reading-level/forbidden-phrase hook MUST run on the **cached translations**, not just the English source. Starter non-English equivalents (extend as copy is finalized):
  - **Spanish**: "usted califica", "usted es elegible", "cumple los requisitos".
  - **Portuguese**: "você se qualifica", "você é elegível", "atende aos critérios".
  - **Haitian Creole**: "ou kalifye", "ou elijib".
  - **Chinese (Simplified)**: "您符合条件", "您符合资格", "您合格".
  - **Vietnamese** (needs review by a Vietnamese speaker — machine-drafted, not verified): "bạn đủ điều kiện" (you are eligible), "bạn đủ tiêu chuẩn" (you qualify), "bạn phù hợp" (you're a match), "bạn đáp ứng các tiêu chí" (you meet the criteria), "được bảo đảm" (guaranteed).
- If translation adds a language, its forbidden-phrase equivalents must be added **before** that language ships.

## 2. Plain language, 8th-grade reading level
- All user-facing **English** copy must be at or below an **8th-grade reading level**.
- Prefer short sentences, common words, and active voice. Explain medical terms in plain words.
- This applies to trial summaries, quick-check questions, buttons, errors, and tooltips.

## 3. Privacy — health answers stay in the browser
- Do **not** store or transmit the user's health answers anywhere beyond the browser.
- The **only** data that may leave the browser is the **search query** (condition + location + distance) needed to call ClinicalTrials.gov and MBTA.
- No accounts, no analytics on health answers, no logging of quick-check responses server-side.

## 4. Always show contact + disclaimer
- Every trial view must display the study's **contact** (central contact or site contact from the API).
- Every page/view must display the disclaimer: **"TrialPath is not medical advice. The study team decides eligibility."**

## 5. Preserve identifiers and contacts exactly
- When translating or rewriting any content, preserve **exactly** and unchanged:
  - **NCT IDs** (e.g. `NCT01234567`)
  - **phone numbers**
  - **email addresses**
- Never translate, reformat, or "simplify" these values.

## 6. Scope boundaries
- Do not diagnose, recommend treatment, or interpret medical results.
- Do not rank trials by anything implying medical suitability — only by distance and factual filters (recruiting status, location).
- If unsure whether copy crosses a line, choose the more cautious "contact the study team" framing.
