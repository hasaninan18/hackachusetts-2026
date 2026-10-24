import { haversineMi } from "./geo";

// Nearest-first ordering for search results, kept pure (no I/O) so it can be property-tested
// apart from the async, server-only getTrials in lib/data.ts. All distances are miles.

type Point = { lat: number; lon: number };

/**
 * A sorted copy of `trials`, nearest first by `distanceMi`. Never mutates the input.
 * Stable: equal distances keep their input order. A distance that is NaN sorts last
 * instead of scrambling the order of the others.
 */
export function rankBySiteDistance<T extends { distanceMi: number }>(trials: readonly T[]): T[] {
  const key = (d: number) => (Number.isNaN(d) ? Infinity : d);
  return trials
    .map((trial, index) => ({ trial, index, d: key(trial.distanceMi) }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.index - b.index))
    .map((entry) => entry.trial);
}

/**
 * Straight-line miles from `origin` to each trial's nearest site, keeping trials within
 * `radiusMi` (inclusive), nearest first. Returns new objects; the input is not changed.
 */
export function rankWithinRadius<T extends { nearestSite: Point }>(
  trials: readonly T[],
  origin: Point,
  radiusMi: number,
): (T & { distanceMi: number })[] {
  const measured = trials.map((trial) => ({
    ...trial,
    distanceMi: haversineMi(origin.lat, origin.lon, trial.nearestSite.lat, trial.nearestSite.lon),
  }));
  return rankBySiteDistance(measured.filter((trial) => trial.distanceMi <= radiusMi));
}
