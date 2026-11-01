// Build the national ZIP lookup shards in public/zcta/ (docs/NATIONAL_PLAN.md §3).
//
// Usage:
//   node scripts/build-zcta.mjs <2024_Gaz_zcta_national.txt> <tab20_zcta520_county20_natl.txt> [outDir]
//
// Inputs (both free Census downloads, not committed):
//   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip
//   https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt
//
// Output: one file per 3-digit ZIP prefix, e.g. public/zcta/021.json =
//   {"02124":[42.2859,-71.075,"MA"], ...}
// The state is the one holding the most of the ZIP area's land (a few ZIP areas cross state
// lines). The browser fetches only the prefix shard it needs, so a full ZIP never leaves it.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** State FIPS code → USPS code (50 states, DC, Puerto Rico). */
const FIPS_TO_USPS = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
  "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
  "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
  "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
  "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
  "55": "WI", "56": "WY", "72": "PR",
};

/** Read a delimited Census file into header-keyed rows (strips a BOM and trailing spaces). */
function readTable(path, delimiter) {
  const lines = readFileSync(path, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(delimiter).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

/** ZIP → USPS state, choosing the county part with the most land. */
function zipStates(relPath) {
  const best = new Map();
  for (const row of readTable(relPath, "|")) {
    const zip = row.GEOID_ZCTA5_20;
    if (!zip) continue;
    const state = FIPS_TO_USPS[row.GEOID_COUNTY_20.slice(0, 2)];
    if (!state) continue;
    const land = Number(row.AREALAND_PART);
    const current = best.get(zip);
    if (!current || land > current.land) best.set(zip, { state, land });
  }
  return new Map([...best].map(([zip, { state }]) => [zip, state]));
}

function main() {
  const [gazPath, relPath, outDir = join("public", "zcta")] = process.argv.slice(2);
  if (!gazPath || !relPath) {
    console.error("usage: node scripts/build-zcta.mjs <gazetteer.txt> <zcta-county.txt> [outDir]");
    process.exit(1);
  }

  const states = zipStates(relPath);
  const shards = new Map();
  let missingState = 0;
  for (const row of readTable(gazPath, "\t")) {
    const zip = row.GEOID;
    const lat = Number(row.INTPTLAT);
    const lon = Number(row.INTPTLONG);
    if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const state = states.get(zip);
    if (!state) {
      missingState++;
      continue;
    }
    const prefix = zip.slice(0, 3);
    if (!shards.has(prefix)) shards.set(prefix, {});
    shards.get(prefix)[zip] = [Number(lat.toFixed(4)), Number(lon.toFixed(4)), state];
  }

  // Rebuild from scratch so a ZIP area the Census retired never lingers.
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^\d{3}\.json$/.test(f)) rmSync(join(outDir, f));
  let zips = 0;
  for (const [prefix, table] of [...shards].sort()) {
    const sorted = Object.fromEntries(Object.entries(table).sort());
    zips += Object.keys(sorted).length;
    writeFileSync(join(outDir, `${prefix}.json`), JSON.stringify(sorted) + "\n");
  }
  console.log(`wrote ${zips} ZIP areas in ${shards.size} shards to ${outDir}`);
  if (missingState) console.warn(`skipped ${missingState} ZIP areas with no county match`);
}

main();
