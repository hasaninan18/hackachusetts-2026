import type { Translate } from "../lib/i18n";

// The results heading line, all inside one role="status" region so screen readers announce
// both the count and, when the list is trimmed, which part of it is shown.
//
// `total` counts every in-radius study the search found and `shown` is how many are listed
// (the nearest ones). When the live search hit its page cap (`truncated`), `total` is only a
// lower bound and the list is the nearest of the studies it did read, not of all of them, so
// the copy says "at least" and "nearby" instead of an exact count and "the closest".
export function ResultsCount({
  shown,
  total,
  truncated = false,
  cond,
  mi,
  t,
}: {
  shown: number;
  total: number;
  truncated?: boolean;
  cond: string;
  mi: number;
  t: Translate;
}) {
  const n = Math.max(total, shown);
  const count = truncated
    ? t("results.countAtLeast", { n, cond, mi })
    : n === 1
      ? t("results.countOne", { cond, mi })
      : t("results.count", { n, cond, mi });
  const note =
    shown < n
      ? truncated
        ? t("results.showingNearby", { n: shown })
        : t("results.showingClosest", { n: shown })
      : null;
  return (
    <span role="status" className="font-semibold">
      {count}
      {note && <span className="ml-2 font-normal">{note}</span>}
    </span>
  );
}
