// Turns a ClinicalTrials.gov phone string into a tel: href. Display text is never altered.
//
// Decisions:
// - Spaces, dashes, dots and parentheses are dropped; a "+" is kept only when it leads the number
//   (so "(+1) 866-867-7178" -> "tel:+18668677178").
// - Extensions ("ext 123", "ext. 123", "x123") become ",123" (a pause, then the extension).
// - Vanity numbers mixing letters and a parenthesised numeric form, e.g.
//   "1-877-CTLILLY (1-877-285-4559)", use the parenthesised digits.
// - Any other string with letters in the number part returns null rather than guess a wrong number.
// - Fewer than 7 digits returns null.

const EXT_RE = /\s*(?:ext\.?|extension|x)\s*(\d{1,6})\s*$/i;

export function telHref(phone: string): string | null {
  let raw = phone.trim();
  if (!raw) return null;

  let ext = "";
  const extMatch = raw.match(EXT_RE);
  if (extMatch) {
    ext = extMatch[1];
    raw = raw.slice(0, extMatch.index).trim();
  }

  if (/[a-z]/i.test(raw)) {
    // Vanity number: fall back to a parenthesised purely-numeric group, if any.
    const groups = [...raw.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
    const numeric = groups.find((g) => !/[a-z]/i.test(g) && g.replace(/\D/g, "").length >= 7);
    if (!numeric) return null;
    raw = numeric.trim();
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;

  const plus = /^\(?\s*\+/.test(raw) ? "+" : "";
  return `tel:${plus}${digits}${ext ? `,${ext}` : ""}`;
}
