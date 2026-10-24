import type { Site, Stop } from "@/lib/types";
import type { Translate } from "@/lib/i18n";
import { drivingDirectionsUrl, formatMiles, transitDirectionsUrl } from "@/lib/geo";
import { LineChip } from "./LineChip";

function Access({ wheelchair, t }: { wheelchair: boolean | null; t: Translate }) {
  if (wheelchair === true) {
    return (
      <p className="text-fit">
        <span aria-hidden="true">♿ </span>
        {t("go.accessible")}
      </p>
    );
  }
  if (wheelchair === false) return <p className="text-ask">{t("go.notAccessible")}</p>;
  return <p className="text-muted">{t("go.accessUnknown")}</p>;
}

export function GettingThere({
  site,
  stops,
  origin,
  t,
}: {
  site: Site;
  stops: Stop[];
  origin?: { lat: number; lon: number };
  t: Translate;
}) {
  const nearest = [...stops].sort((a, b) => a.walkMi - b.walkMi).slice(0, 3);
  const hasTransit = nearest.length > 0;

  return (
    <section className="mt-6 border-t border-line pt-6">
      <h2 className="text-xl font-semibold text-ink">{t("go.heading")}</h2>
      <h3 className="mt-3 text-base font-medium text-muted">{t("go.nearest")}</h3>

      {!hasTransit ? (
        <p className="mt-2 text-ink">{t("go.noStops")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {nearest.map((stop) => (
            <li key={stop.id} className="space-y-1 py-3">
              <p className="font-bold text-ink">{stop.name}</p>
              {stop.lines.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {stop.lines.map((line) => (
                    <LineChip key={line.name} line={line} />
                  ))}
                </div>
              )}
              <p className="text-ink">{t("go.walk", { mi: formatMiles(stop.walkMi) })}</p>
              <Access wheelchair={stop.wheelchair} t={t} />
            </li>
          ))}
        </ul>
      )}

      {site.locationPrecision !== "facility" && (
        <p className="mt-2 text-sm text-muted">{t("go.approx")}</p>
      )}

      <div className="no-print mt-4 flex flex-wrap gap-3">
        <a
          href={transitDirectionsUrl(site, origin)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-5 text-base font-medium text-white hover:bg-primary-hover"
        >
          {t("go.directions")}
        </a>
        {/* No stop in range: Google Maps may still find a longer transit trip, so keep that
            link and add driving (structure.md: "a driving directions link, not just transit"). */}
        {!hasTransit && (
          <a
            href={drivingDirectionsUrl(site, origin)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-primary bg-card px-5 text-base font-medium text-primary"
          >
            {t("go.drivingDirections")}
          </a>
        )}
      </div>
    </section>
  );
}
