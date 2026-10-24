// Age parsing, kept pure (no I/O, no clock) so it can be unit- and property-tested.
// Two different inputs, two functions:
//   parseAge(raw)       a ClinicalTrials.gov eligibility age, e.g. "18 Years" or "6 Months"
//   parseAgeInput(text) the age a person types into the quick check, e.g. "70"

/**
 * A ClinicalTrials.gov eligibility age in years: "18 Years" → 18, "6 Months" → 0.5.
 * "N/A", "No maximum", empty, missing or unreadable → null, which callers treat as no limit.
 * Never throws. Same behavior as parseAge on spec/trial-search-api, so lib/clinicaltrials.ts
 * can import this one instead of keeping its own copy.
 *
 * Known gap: newborn studies also use Weeks, Days, Hours and Minutes (15 recruiting MA trials
 * have a maximum age in those units on 2026-10-24). Those read as null = no limit for now;
 * handling them also needs whole-year age input and unit-aware reason text in the quick check.
 */
export function parseAge(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(year|month)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  // Divide rather than multiply by 1/12 so "6 Months" is exactly 0.5 and "12 Months" exactly 1.
  return match[2].toLowerCase() === "month" ? value / 12 : value;
}

/**
 * The age typed into the quick check. Only a whole number from 0 to 120 counts; anything
 * else (blank, letters, decimals, 121 and up) is "not answered", never a mismatch, so a
 * typo can't rule anyone out.
 */
export function parseAgeInput(text: string): number | undefined {
  if (!/^\d{1,3}$/.test(text)) return undefined;
  const n = Number(text);
  return n <= 120 ? n : undefined;
}
