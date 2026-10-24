// The link a person shares from a trial page is the page itself and nothing more. The search
// that led there (condition, rough location, distance) is dropped, so sharing never passes on
// what someone searched for or where they are. Quick-check answers are never in a URL at all.
// ?mock=1 is kept so a demo link opens the same fixture for whoever receives it.
export function shareUrl(href: string): string {
  const url = new URL(href);
  const out = new URL(url.pathname, url.origin);
  if (url.searchParams.get("mock") === "1") out.searchParams.set("mock", "1");
  return out.toString();
}
