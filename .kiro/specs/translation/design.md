# Design — translation

## Overview

The translation feature restates one trial's plain-language card (`whatItStudies`, `whatYouDo`,
`timeCommitment`) and its quick-check question text in Spanish (`es`), Portuguese (`pt`), Haitian
Creole (`ht`), or Simplified Chinese (`zh`). English (`en`) is the untranslated source. Every
translated result is:

- produced once per `(NCT id, language)` and cached, so the demo is fast and cheap;
- stripped of its NCT ids / phone numbers / emails before translation and restored after, so those
  tokens are preserved byte-for-byte (safety.md §5);
- screened by the forbidden-phrase check in its own language before it is cached or shown
  (safety.md §1); and
- labelled machine-translated for the user (product.md §5).

This design documents what the current code already provides, maps each requirement to where it is
satisfied, and specifies the parts that do not exist yet as a **"Proposed change for the owner"**
section — drafts only. Per the instruction and structure.md ownership, **nothing in `lib/`, `app/`,
or `components/` is edited by this spec**; the drafts are ready-to-lift code for Hasan (API /
`lib/*` clients) and Neil (`lib/i18n/**`, components).

## Architecture

```
POST /api/simplify?lang=xx            (Hasan — app/api/simplify/route.ts, new)
  cond + NCT id + requested lang
        |
        v
  cache lookup: key = `${nctId}:${lang}`  ---- hit ----> cached Simplified (already screened)
        |  (miss)
        v
  English Simplified (source)           (lib/mock/simplified.ts today; CT.gov + Bedrock later)
        |
        v
  maskTokens(text)  --------------------------------->  text with __TP_TOKEN_n__ placeholders
        |                                                        |
        v                                                        |
  Bedrock Converse (Nova 2 Lite -> Nova Pro)  translate per-field|
        |                                                        |
        v                                                        v
  restoreTokens(translated, map)  <----------------------  original NCT/phone/email tokens
        |
        v
  verifyTokens(source, restored)   -- mismatch --> reject -> fall back to English
        |  (ok)
        v
  parseSimplified(payload, lang, fallback)   (lib/simplify.ts — TODAY)
        |
        v
  forbidden-phrase gate: findForbiddenPhrase over every field   (tests/copy-guard.mjs — TODAY)
        |  hit --> reject (do not cache, do not show) -> fall back to English
        v  clean
  cache.set(`${nctId}:${lang}`, { ...simplified, machineTranslated: true })
        |
        v
  client card + QuickCheck render, with a "machine-translated" badge   (Neil — components/**)
  UI labels (trial.*, fit.*) from lib/i18n getDictionary(lang)         (lib/i18n — TODAY, maps empty)
```

Data boundaries (safety.md §3): the only thing that leaves the device is the trial lookup
(condition + NCT id + language). The person's quick-check answers are never part of translation —
translation operates on the trial's public card and questions only.

## What the current code already provides

| Capability | Where | Status |
|-----------|-------|--------|
| Parse + normalize a non-English `/api/simplify` payload into `Simplified` | `lib/simplify.ts` `parseSimplified` | **done** |
| Accept both payload shapes; map `rulesOut`→`ruleOutIf`, numeric `id`→string; `timeCommitment` fallback | `lib/simplify.ts`; asserted in `lib/simplify.test.ts` | **done** |
| Carry requested `lang` through when payload omits/mis-types it | `lib/simplify.ts` | **done** |
| Reject untrusted payloads (null, no summary, unruled question, duplicate ids) | `lib/simplify.ts`; `lib/simplify.test.ts` | **done** |
| Forbidden-phrase checker covering en/es/pt/ht/zh, pure + total | `tests/copy-guard.mjs` `findForbiddenPhrase` | **done** |
| `tel:` href from a phone string without altering the visible number | `lib/phone.ts` `telHref` | **done** |
| Resolve es/pt/ht/zh UI dictionary with English fallback | `lib/i18n/index.ts` `getDictionary` | **done (maps empty)** |
| `zh-Hans` for Simplified Chinese; Simplified-Chinese label | `lib/i18n/index.ts` `HTML_LANG`, `LANG_NAMES` | **done** |
| Mock English/es `Simplified` fixtures for the demo trials | `lib/mock/simplified.ts` | **done (es partial)** |

## Requirements traceability

| Req | Where satisfied / to be satisfied | Status |
|-----|-----------------------------------|--------|
| 1 Translate card + questions | `parseSimplified` normalizes/keeps `id`+`ruleOutIf`; the translate call is new | partial — core done, call is a gap |
| 2 Translate UI labels | `getDictionary` + `HTML_LANG` done; `dictionaries.ts` maps empty | partial — gap: fill maps |
| 3 Cache per (NCT id, language) | **new** — see "Translation cache" | gap |
| 4 Preserve NCT/phone/email verbatim | **new** — see "Token preservation" (mask/restore/verify) | gap |
| 5 Machine-translated label | **new** — `machineTranslated` flag + badge | gap |
| 6 Forbidden-phrase gate before caching | checker done (`findForbiddenPhrase`); invocation is **new** | partial — checker done, gate is a gap |
| 7 Never claim eligibility, any language | enforced via Req 6 gate + safety.md copy | gap (depends on 6) |
| 8 Supported-languages gate | `LANGS`/`LANG_NAMES` exist; `vi` excluded until FORBIDDEN added | partial — policy documented |
| 9 Robust untrusted-payload handling | `parseSimplified` null/shape/lang handling | done (call-failure fallback is new) |

## Known gaps

These are the parts no code implements today. Each is drafted in "Proposed change for the owner".

1. **Translation call.** No code calls a translator. There is no `lib/bedrock.ts`, no
   `app/api/simplify/route.ts`, and the only `Simplified` data is the hand-written mock in
   `lib/mock/simplified.ts` (English for both trials, Spanish for one). Target: a Bedrock Converse
   call that translates each translatable field.
2. **`(NCT id, language)` cache.** No cache exists. Nothing keys a translation by NCT id + language
   or pre-warms the demo trials.
3. **Machine-translated flag.** `Simplified` has no field signalling a machine translation, and no
   component renders a badge. Today a view could only infer "translated" from `lang !== "en"`,
   which Req 5.4 rejects.
4. **Forbidden-phrase gate.** `findForbiddenPhrase` exists and covers all four languages, but it is
   only wired into the copy-guard CLI/hook over source files. Nothing runs it over a freshly
   produced translation before caching/showing it.
5. **Empty UI dictionaries.** `lib/i18n/dictionaries.ts` is `{}` for every language, so `trial.*`
   and `fit.*` labels render in English for es/pt/ht/zh via fallback. The card body/questions would
   be translated (gap 1) while the surrounding labels would not, until the maps are filled.

---

## Proposed change for the owner — NOT applied here

> **Ownership (structure.md).** `lib/bedrock.ts`, `lib/simplify.ts`, and `app/api/**` are Hasan's;
> `lib/i18n/**`, `lib/types.ts`, and `components/**` are Neil's. The drafts below are ready-to-lift
> for the PR. Nothing in `lib/`, `app/`, or `components/` is edited by this spec. New pure helpers
> live in `lib/` with co-located tests per structure.md (`lib/<name>.test.ts`); the cross-cutting
> property test is Akash's (`tests/`).

### Env vars (tech.md — DECIDED)

The Bedrock client reads these; never commit them (all set in Vercel):

- `AWS_BEARER_TOKEN_BEDROCK` — bearer token; the SDK picks it up automatically.
- `AWS_REGION` — `us-east-2` (Ohio).
- `BEDROCK_MODEL_ID` — `us.amazon.nova-2-lite-v1:0` (primary).
- `BEDROCK_FALLBACK_MODEL_ID` — `us.amazon.nova-pro-v1:0` (fallback).

Claude is NOT available on the AWS Free plan — do not add Claude model IDs.

### Draft 1 — Token preservation (`lib/preserveTokens.ts`, new, Hasan; pure)

Swap every NCT id, phone number, and email out for an opaque placeholder **before** translation,
restore them **after**, then verify the restored set equals the source set. Placeholders are chosen
so no translator will "helpfully" alter them: an ASCII sentinel with an index, no spaces, no
punctuation a model would localise.

```ts
// lib/preserveTokens.ts — pure, no I/O. Co-located test: lib/preserveTokens.test.ts.

// Order matters: emails before phones (an email can contain digits), NCT ids are distinct.
const NCT_RE   = /NCT\d{8}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Loose phone: optional +, then 7+ digits possibly broken by spaces, dashes, dots, parens, ext.
const PHONE_RE = /\+?\d[\d\s().\-]{5,}\d(?:\s*(?:ext\.?|x)\s*\d{1,6})?/gi;

const SENTINEL = (n: number) => `\uE000TP${n}\uE000`; // private-use char brackets; not translatable

export interface Masked { text: string; tokens: string[]; }

export function maskTokens(input: string): Masked {
  const tokens: string[] = [];
  const stash = (m: string) => { tokens.push(m); return SENTINEL(tokens.length - 1); };
  // Replace in a fixed order so indices are stable and non-overlapping.
  const text = input
    .replace(NCT_RE, stash)
    .replace(EMAIL_RE, stash)
    .replace(PHONE_RE, stash);
  return { text, tokens };
}

export function restoreTokens(translated: string, tokens: string[]): string {
  return translated.replace(/\uE000TP(\d+)\uE000/g, (whole, i) => tokens[Number(i)] ?? whole);
}

// Set-equality check used by verifyTokens: NCT ids, emails, and phones (normalized to digits)
// present in `a` must equal those in `b`, regardless of order.
export function tokenSet(text: string): { nct: Set<string>; email: Set<string>; phone: Set<string> } {
  const nct = new Set(text.match(NCT_RE) ?? []);
  const email = new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()));
  const phone = new Set((text.match(PHONE_RE) ?? []).map((p) => p.replace(/\D/g, "")));
  return { nct, email, phone };
}

export function verifyTokens(source: string, restored: string): boolean {
  const a = tokenSet(source), b = tokenSet(restored);
  const eq = (x: Set<string>, y: Set<string>) =>
    x.size === y.size && [...x].every((v) => y.has(v));
  return eq(a.nct, b.nct) && eq(a.email, b.email) && eq(a.phone, b.phone);
}
```

Usage per field: `const { text, tokens } = maskTokens(src); const out = restoreTokens(await
translate(text), tokens); if (!verifyTokens(src, out)) throw new TokenMismatch();`. The throw
forces the whole translation to fall back to English (Req 4.4) rather than ship an altered number.

> Note on `telHref`: because phones are restored byte-for-byte, `lib/phone.ts telHref()` yields the
> same `tel:` target from the translated text as from the source — the preserve step is what makes
> that guarantee hold.

### Draft 2 — Bedrock translate call (`lib/bedrock.ts`, new, Hasan)

```ts
// lib/bedrock.ts — the only I/O. Converse API, primary model then fallback.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { maskTokens, restoreTokens, verifyTokens } from "./preserveTokens";
import type { Lang } from "./types";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION }); // us-east-2
const PRIMARY  = process.env.BEDROCK_MODEL_ID ?? "us.amazon.nova-2-lite-v1:0";
const FALLBACK = process.env.BEDROCK_FALLBACK_MODEL_ID ?? "us.amazon.nova-pro-v1:0";

const LANG_NAME: Record<Exclude<Lang, "en">, string> = {
  es: "Spanish", pt: "Portuguese", ht: "Haitian Creole", zh: "Simplified Chinese",
};

// Translate ONE field. Masks tokens, translates, restores, verifies. Throws on token mismatch.
async function translateField(text: string, lang: Exclude<Lang, "en">): Promise<string> {
  if (!text.trim()) return text;
  const { text: masked, tokens } = maskTokens(text);
  const system = [{ text:
    `Translate the user's text into ${LANG_NAME[lang]} at a 6th–8th grade reading level. ` +
    `Keep every \uE000TP<number>\uE000 marker exactly as-is. Do not add claims about eligibility ` +
    `or qualifying. Return only the translation.` }];
  const body = { messages: [{ role: "user" as const, content: [{ text: masked }] }], system };

  const out = await converseWithFallback(body);
  const restored = restoreTokens(out, tokens);
  if (!verifyTokens(text, restored)) throw new Error("token-mismatch");
  return restored;
}

async function converseWithFallback(body: object): Promise<string> {
  for (const modelId of [PRIMARY, FALLBACK]) {
    try {
      const r = await client.send(new ConverseCommand({ modelId, ...body }));
      const t = r.output?.message?.content?.[0]?.text;
      if (t) return t;
    } catch { /* try fallback */ }
  }
  throw new Error("bedrock-unreachable");
}

// Translate the whole card + questions. Caller screens the result with the forbidden-phrase gate.
export async function translateSimplified(src: Simplified, lang: Exclude<Lang, "en">) {
  const [whatItStudies, whatYouDo, timeCommitment] = await Promise.all([
    translateField(src.whatItStudies, lang),
    translateField(src.whatYouDo, lang),
    translateField(src.timeCommitment, lang),
  ]);
  const questions = await Promise.all(
    src.questions.map(async (q) => ({ ...q, text: await translateField(q.text, lang) })),
  );
  return { lang, whatItStudies, whatYouDo, timeCommitment, questions };
}
```

If `translateSimplified` throws (token mismatch or Bedrock unreachable), the route falls back to
the English card or the structured quick-check only — Req 9.4 and tech.md's last-resort fallback.

### Draft 3 — The cache + forbidden-phrase gate (`app/api/simplify/route.ts`, new, Hasan)

```ts
// app/api/simplify/route.ts
import { translateSimplified } from "@/lib/bedrock";
import { parseSimplified } from "@/lib/simplify";
import { findForbiddenPhrase } from "@/lib/forbidden"; // small re-export of tests/copy-guard.mjs logic
import { getMockSimplified } from "@/lib/mock/simplified";
import { isLang } from "@/lib/i18n";
import type { Lang, Simplified } from "@/lib/types";

// Module-scope cache: key `${nctId}:${lang}` -> screened, machine-translated Simplified.
// Per-instance is enough for the demo; swap for a durable store later. Req 3.
const cache = new Map<string, Simplified & { machineTranslated: boolean }>();
const keyOf = (nctId: string, lang: Lang) => `${nctId}:${lang}`;

// Fields the forbidden-phrase gate must screen (Req 6.1).
function screen(s: Simplified): boolean {
  const fields = [s.whatItStudies, s.whatYouDo, s.timeCommitment, ...s.questions.map((q) => q.text)];
  return fields.every((f) => findForbiddenPhrase(f) === null);
}

export async function POST(req: Request) {
  const { nctId, lang } = await req.json();
  if (!isLang(lang)) return Response.json({ error: "bad-lang" }, { status: 400 });

  // English: return the source card, no translation, no machine-translated label (Req 1.4, 5.2).
  const english = getMockSimplified(nctId, "en"); // later: CT.gov + Bedrock plain-language summary
  if (!english) return Response.json({ error: "not-found" }, { status: 404 });
  if (lang === "en") return Response.json({ ...english, machineTranslated: false });

  const key = keyOf(nctId, lang);
  const hit = cache.get(key);
  if (hit) return Response.json(hit); // Req 3.1 — never re-translate

  try {
    const raw = await translateSimplified(english, lang); // masks/restores/verifies tokens (Req 4)
    const parsed = parseSimplified(raw, lang, english.timeCommitment); // Req 9
    if (!parsed) return Response.json({ ...english, machineTranslated: false }); // untrusted -> English
    if (!screen(parsed)) return Response.json({ ...english, machineTranslated: false }); // Req 6.2/6.3
    const result = { ...parsed, machineTranslated: true }; // Req 5.4
    cache.set(key, result); // Req 3.2/3.4 — only a screened result is cached
    return Response.json(result);
  } catch {
    // token mismatch or Bedrock unreachable -> English card (Req 4.4, 9.4, tech.md fallback)
    return Response.json({ ...english, machineTranslated: false });
  }
}
```

Key points this draft locks in:
- **Cache key is `(NCT id, language)`** and only a **screened** result is ever stored (Req 3.3,
  3.4). Pre-warming the demo trials is a loop over the 5–10 NCT ids × 4 languages hitting this same
  path, so pre-warmed entries get the same token/label/screen treatment (Req 3.5).
- **Forbidden-phrase gate runs on the translated fields**, not the English source (Req 6.4), and a
  hit means "do not cache, do not show" — fall back to English (Req 6.2, 6.3, 7.2).
- **English is never labelled machine-translated** (Req 5.2); only a screened translation carries
  `machineTranslated: true`.

> `@/lib/forbidden` is a tiny module that re-exports `findForbiddenPhrase` / `ALL_FORBIDDEN` from
> the existing `tests/copy-guard.mjs` logic so route code can import it without reaching into
> `tests/`. The phrase list stays single-sourced; it must track safety.md §1 (Req 8.3).

### Draft 4 — `machineTranslated` flag (`lib/types.ts`, Neil) + badge (components, Neil)

```diff
 export interface Simplified {
   lang: Lang;
   whatItStudies: string;
   whatYouDo: string;
   timeCommitment: string;
   questions: FitQuestion[]; // 3–6
+  // True when the card/questions were machine-translated from English. English source = false.
+  // The card shows a visible "machine-translated" badge when true (safety.md / product.md §5).
+  machineTranslated?: boolean;
 }
```

- `components/TrialPlain.tsx` (Neil): when `simplified.machineTranslated` is true, render a visible
  badge using a new i18n key, e.g. `"trial.machineTranslated": "Machine-translated. Check details
  with the study team."` (≤ 8th grade; run copy-guard on it). Hidden for `en` (Req 5.1, 5.2, 5.3).
- The badge text itself is screened by copy-guard like all copy; it contains no forbidden phrase.

### Draft 5 — Fill the UI dictionaries (`lib/i18n/dictionaries.ts`, Neil)

Translate the `trial.*` and `fit.*` keys (and the new `trial.machineTranslated`) for `es`, `pt`,
`ht`, `zh`, keeping every `{placeholder}` token unchanged (Req 2.4, 2.5). Each language's cached
translations — including these labels — must be screened by copy-guard before shipping, and that
screening runs on the translated strings, not just English (safety.md §1, Req 6.4). The copy-guard
CLI already accepts a file list, so `node tests/copy-guard.mjs lib/i18n/dictionaries.ts` covers it.

## Error, empty, and fallback states

- **Translation call fails** (Bedrock unreachable) → English card (or structured quick-check only);
  never block the trial view (Req 9.4, tech.md).
- **Token mismatch** (an NCT/phone/email changed) → reject the translation, English card (Req 4.4).
- **Forbidden phrase in a translated field** → reject, do not cache, English card (Req 6.2, 6.3).
- **Untrusted payload shape** → `parseSimplified` returns `null` → English card (Req 9.1).
- **Unsupported language** (`vi` or anything outside es/pt/ht/zh/en) → 400 / not offered (Req 8).

## Design decisions and rationale

- **Why mask/restore/verify instead of trusting the model?** A model told to "keep the phone
  number" will sometimes reformat or localise it. Replacing tokens with an opaque private-use
  sentinel removes the temptation entirely, and `verifyTokens` turns any drift into a hard failure
  that falls back to English rather than shipping a wrong number (safety.md §5 is non-negotiable).
- **Why screen with the existing `findForbiddenPhrase`?** It is already pure, total, and carries the
  es/pt/ht/zh equivalents from safety.md §1. Reusing it (via a thin re-export) keeps the phrase list
  single-sourced and satisfies "run the check on the cached translations, not just English."
- **Why cache per `(NCT id, language)` in module scope?** It is the smallest thing that makes the
  demo fast and lets us pre-warm; a durable store can replace the `Map` later without changing the
  key or the screen-before-cache rule.
- **Why a `machineTranslated` flag rather than inferring from `lang`?** Req 5.4: the English card is
  not translated, and a future English-source-in-`en` path must stay unlabelled. An explicit flag
  also means a rejected-then-fell-back-to-English result is correctly unlabelled.
- **Why keep it owner-authored?** structure.md's ownership map (Hasan: `app/api/**`, `lib/bedrock.ts`,
  `lib/simplify.ts`; Neil: `lib/i18n/**`, `lib/types.ts`, components). Drafting rather than editing
  keeps the Kiro-workflow history clean and avoids cross-owner merge conflicts.

### Blast radius summary

| File | Owner | Change |
|------|-------|--------|
| `lib/preserveTokens.ts` (+ `.test.ts`) | Hasan | **new** — mask/restore/verify NCT/phone/email |
| `lib/bedrock.ts` | Hasan | **new** — Converse translate call, primary→fallback model |
| `app/api/simplify/route.ts` | Hasan | **new** — cache + screen-before-cache + English fallback |
| `lib/forbidden.ts` | Hasan/Akash | **new** — thin re-export of the copy-guard phrase logic |
| `lib/simplify.ts` | Hasan | **unchanged** — `parseSimplified` already fits |
| `lib/types.ts` | Neil | +optional `machineTranslated?: boolean` on `Simplified` |
| `components/TrialPlain.tsx` | Neil | render machine-translated badge when flag is true |
| `lib/i18n/dictionaries.ts` | Neil | fill es/pt/ht/zh `trial.*`/`fit.*` + badge key |
| `lib/i18n/en.ts` | Neil | +`trial.machineTranslated` key |
| `tests/translation.property.test.ts` | Akash | token-preservation + screen-before-cache invariants |
