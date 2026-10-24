const EARTH_RADIUS_MI = 3958.8;

export function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Massachusetts ZIPs are 010xx–027xx (plus 055xx PO boxes in Andover, which have no residents).
export function isMaZip(zip: string): boolean {
  if (!/^\d{5}$/.test(zip)) return false;
  const prefix = Number(zip.slice(0, 3));
  return prefix >= 10 && prefix <= 27;
}

export function formatMiles(mi: number): string {
  return mi < 0.1 ? "< 0.1" : mi < 10 ? mi.toFixed(1) : Math.round(mi).toString();
}

type Point = { lat: number; lon: number };

// Google Maps directions deep link (no API key). Only coordinates go into the URL.
function directionsUrl(travelmode: "transit" | "driving", dest: Point, origin?: Point): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${dest.lat},${dest.lon}`,
    travelmode,
  });
  if (origin) params.set("origin", `${origin.lat},${origin.lon}`);
  return `https://www.google.com/maps/dir/?${params}`;
}

export function transitDirectionsUrl(dest: Point, origin?: Point): string {
  return directionsUrl("transit", dest, origin);
}

// The no-transit fallback (structure.md "No transit stop nearby"; getting-there spec N1).
export function drivingDirectionsUrl(dest: Point, origin?: Point): string {
  return directionsUrl("driving", dest, origin);
}
