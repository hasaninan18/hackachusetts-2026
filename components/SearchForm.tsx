"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { isMaZip } from "@/lib/geo";
import { format } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import zips from "@/lib/ma-zips.json";
import type { Lang } from "@/lib/types";

const RADII = [5, 10, 25] as const;
const ZIP_TABLE = zips as unknown as Record<string, [number, number]>;

type Coords = { lat: number; lon: number };
type LocStatus = "idle" | "locating" | "set" | "denied";
type Errors = { cond?: string; zip?: string };

export function SearchForm({ lang, dict }: { lang: Lang; dict: Dictionary }) {
  const router = useRouter();
  const uid = useId();
  const condRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [cond, setCond] = useState("");
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState<number>(10);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [loc, setLoc] = useState<LocStatus>("idle");
  const [errors, setErrors] = useState<Errors>({});

  // Pre-fill from the URL after mount (not during render) to avoid a hydration mismatch.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const c = sp.get("cond");
    const r = Number(sp.get("radius"));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (c) setCond(c.slice(0, 200));
    if ((RADII as readonly number[]).includes(r)) setRadius(r);
  }, []);

  const ids = {
    cond: `${uid}-cond`,
    condHint: `${uid}-cond-hint`,
    condErr: `${uid}-cond-err`,
    zip: `${uid}-zip`,
    zipErr: `${uid}-zip-err`,
    locMsg: `${uid}-loc`,
  };

  function locate() {
    if (loc === "locating") return;
    if (!("geolocation" in navigator)) {
      setLoc("denied");
      return;
    }
    setLoc("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // ~1 km precision: enough for "near me", not an address.
        setCoords({
          lat: Number(pos.coords.latitude.toFixed(2)),
          lon: Number(pos.coords.longitude.toFixed(2)),
        });
        setZip("");
        setErrors((e) => ({ ...e, zip: undefined }));
        setLoc("set");
      },
      () => {
        setCoords(null);
        setLoc("denied");
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Errors = {};
    const term = cond.trim();
    if (!term) next.cond = dict["search.errorCondition"];

    let point: Coords | null = coords;
    if (!point) {
      if (!isMaZip(zip)) {
        next.zip = dict["search.errorZip"];
      } else if (!(zip in ZIP_TABLE)) {
        next.zip = dict["search.errorZipUnknown"];
      } else {
        const [lat, lon] = ZIP_TABLE[zip];
        point = { lat: Number(lat.toFixed(2)), lon: Number(lon.toFixed(2)) };
      }
    }

    // Commit the error text before moving focus so screen readers announce it with the field.
    flushSync(() => setErrors(next));
    if (next.cond) {
      condRef.current?.focus();
      return;
    }
    if (next.zip || !point) {
      zipRef.current?.focus();
      return;
    }

    const qs = new URLSearchParams({
      cond: term,
      lat: point.lat.toFixed(2),
      lon: point.lon.toFixed(2),
      radius: String(radius),
    });
    // Read at submit time so the page needs no Suspense boundary (which re-mounted the form).
    if (new URLSearchParams(window.location.search).get("mock") === "1") qs.set("mock", "1");
    router.push(`/${lang}/results?${qs}`);
  }

  const inputClass =
    "mt-2 block min-h-12 w-full rounded-md border border-muted bg-card px-3 text-base text-ink";
  const zipDescribedBy = [errors.zip ? ids.zipErr : null, loc !== "idle" ? ids.locMsg : null]
    .filter(Boolean)
    .join(" ");

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div>
        <label htmlFor={ids.cond} className="block font-semibold text-ink">
          {dict["search.condition"]}
        </label>
        <p id={ids.condHint} className="mt-1 text-sm text-muted">
          {dict["search.conditionHint"]}
        </p>
        <input
          ref={condRef}
          id={ids.cond}
          name="cond"
          type="text"
          required
          value={cond}
          onChange={(e) => {
            setCond(e.target.value);
            if (errors.cond) setErrors((x) => ({ ...x, cond: undefined }));
          }}
          aria-invalid={errors.cond ? true : undefined}
          aria-describedby={errors.cond ? `${ids.condHint} ${ids.condErr}` : ids.condHint}
          className={inputClass}
        />
        {errors.cond && (
          <p id={ids.condErr} role="alert" className="mt-2 text-sm font-semibold text-ask">
            {errors.cond}
          </p>
        )}
      </div>

      <fieldset>
        <legend className="font-semibold text-ink">{dict["search.where"]}</legend>
        <label htmlFor={ids.zip} className="mt-2 block text-sm text-muted">
          {dict["search.zip"]}
        </label>
        <input
          ref={zipRef}
          id={ids.zip}
          name="zip"
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          value={zip}
          onChange={(e) => {
            setZip(e.target.value.replace(/\D/g, ""));
            if (errors.zip) setErrors((x) => ({ ...x, zip: undefined }));
            if (coords) {
              setCoords(null);
              setLoc("idle");
            }
          }}
          aria-invalid={errors.zip ? true : undefined}
          aria-describedby={zipDescribedBy || undefined}
          className={inputClass}
        />
        {errors.zip && (
          <p id={ids.zipErr} role="alert" className="mt-2 text-sm font-semibold text-ask">
            {errors.zip}
          </p>
        )}
        <button
          type="button"
          onClick={locate}
          aria-disabled={loc === "locating" ? true : undefined}
          className="mt-3 min-h-12 w-full rounded-md border border-line bg-card px-4 font-semibold text-ink hover:bg-paper aria-disabled:text-muted sm:w-auto"
        >
          {dict["search.useLocation"]}
        </button>
        <p id={ids.locMsg} role="status" className="mt-2 text-sm text-muted">
          {loc === "locating" && dict["search.locating"]}
          {loc === "set" && dict["search.locationSet"]}
          {loc === "denied" && dict["search.locationDenied"]}
        </p>
      </fieldset>

      <fieldset>
        <legend className="font-semibold text-ink">{dict["search.distance"]}</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {RADII.map((r) => (
            <label
              key={r}
              className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-line bg-card px-4 text-ink has-[:checked]:border-primary has-[:checked]:font-semibold"
            >
              <input
                type="radio"
                name="radius"
                value={r}
                checked={radius === r}
                onChange={() => setRadius(r)}
                className="size-5 accent-primary"
              />
              {format(dict["search.miles"], { n: r })}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <button
          type="submit"
          className="min-h-12 w-full rounded-md bg-primary px-6 font-semibold text-white hover:bg-primary-hover"
        >
          {dict["search.submit"]}
        </button>
        <p className="mt-3 text-sm text-muted">{dict["search.privacy"]}</p>
      </div>
    </form>
  );
}
