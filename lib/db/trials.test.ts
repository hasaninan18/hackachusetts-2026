// Integration tests: db/schema.sql + loadRows + searchTrials on a real Postgres (PGlite, WASM,
// with PostGIS) in memory. NO network, no Docker.

import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CtgLocation } from "../api-types";
import { type IngestStudy, toRows } from "../ingest/ctgov";
import { applySchema, loadRows, searchTrials } from "./trials";

function loc(overrides: Partial<CtgLocation>): CtgLocation {
  return { country: "United States", status: "RECRUITING", ...overrides };
}

function study(
  nctId: string,
  title: string,
  locations: CtgLocation[],
  extra: { conditions?: string[]; meshes?: string[]; criteria?: string } = {},
): IngestStudy {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: title },
      conditionsModule: { conditions: extra.conditions ?? [] },
      eligibilityModule: { eligibilityCriteria: extra.criteria ?? "" },
      contactsLocationsModule: { locations },
    },
    derivedSection: { conditionBrowseModule: { meshes: (extra.meshes ?? []).map((term) => ({ term })) } },
  };
}

const bmc = loc({ facility: "Boston Medical Center", city: "Boston", state: "Massachusetts", zip: "02118", geoPoint: { lat: 42.335, lon: -71.0728 } });
const mdAnderson = loc({ facility: "MD Anderson", city: "Houston", state: "Texas", zip: "77030", geoPoint: { lat: 29.707, lon: -95.397 } });
const ri = loc({ facility: "Rhode Island Hospital", city: "Providence", state: "Rhode Island", zip: "02903", geoPoint: { lat: 41.811, lon: -71.408 } });

const STUDIES = [
  study("NCT00000001", "Heart attack recovery program", [bmc, mdAnderson], {
    conditions: ["Myocardial Infarction"],
    meshes: ["Myocardial Infarction", "Heart Diseases"],
    criteria: "Must be able to read and understand English",
  }),
  study("NCT00000002", "Type 2 diabetes coaching", [ri], {
    conditions: ["Diabetes Mellitus, Type 2"],
    meshes: ["Diabetes Mellitus, Type 2", "Diabetes Mellitus"],
  }),
  study("NCT00000003", "Breast cancer drug", [mdAnderson], { conditions: ["Breast Neoplasms"] }),
];

const DORCHESTER = { lat: 42.29, lon: -71.08 };
const HOUSTON = { lat: 29.76, lon: -95.37 };

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis } });
  await applySchema(db);
  const rows = STUDIES.map((s) => toRows(s)!);
  await loadRows(db, rows, { prune: true });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("schema + loadRows", () => {
  it("stores trials, sites and the English class", async () => {
    const t = await db.query<{ n: number }>("select count(*)::int as n from trials");
    const s = await db.query<{ n: number }>("select count(*)::int as n from sites");
    expect(t.rows[0].n).toBe(3);
    expect(s.rows[0].n).toBe(4);
    const e = await db.query<{ english: string }>("select english from trials where nct_id = 'NCT00000001'");
    expect(e.rows[0].english).toBe("required");
  });

  it("is idempotent: reapplying the schema and reloading changes nothing", async () => {
    await applySchema(db);
    await loadRows(db, STUDIES.map((s) => toRows(s)!));
    const s = await db.query<{ n: number }>("select count(*)::int as n from sites");
    expect(s.rows[0].n).toBe(4);
  });
});

describe("searchTrials", () => {
  it("finds nearby trials, nearest first, in the TrialSummary shape", async () => {
    const results = await searchTrials(db, { ...DORCHESTER, radiusMi: 60, cond: "" });
    expect(results.map((r) => r.nctId)).toEqual(["NCT00000001", "NCT00000002"]);
    expect(results[0]).toMatchObject({
      title: "Heart attack recovery program",
      nearestSite: { name: "Boston Medical Center", city: "Boston", zip: "02118", locationPrecision: "facility" },
    });
    expect(results[0].distanceMi).toBeGreaterThan(2);
    expect(results[0].distanceMi).toBeLessThan(5);
  });

  it("picks each trial's nearest site", async () => {
    const results = await searchTrials(db, { ...HOUSTON, radiusMi: 10, cond: "" });
    expect(results.map((r) => [r.nctId, r.nearestSite.city])).toEqual([
      ["NCT00000001", "Houston"],
      ["NCT00000003", "Houston"],
    ]);
  });

  it("keeps only sites in the given states, so an MA build never shows a Rhode Island site", async () => {
    const ma = await searchTrials(db, { ...DORCHESTER, radiusMi: 60, cond: "", states: ["MA"] });
    expect(ma.map((r) => r.nctId)).toEqual(["NCT00000001"]);
    // Houston is nearer for NCT00000001, but only its Boston site is in MA.
    const fromHouston = await searchTrials(db, { ...HOUSTON, radiusMi: 2000, cond: "", states: ["MA"] });
    expect(fromHouston.map((r) => r.nearestSite.city)).toEqual(["Boston"]);
  });

  it("respects the radius", async () => {
    expect(await searchTrials(db, { ...DORCHESTER, radiusMi: 10, cond: "" })).toHaveLength(1);
  });

  it("matches conditions through MeSH terms and stemming", async () => {
    const ids = async (cond: string) =>
      (await searchTrials(db, { ...DORCHESTER, radiusMi: 60, cond })).map((r) => r.nctId);
    expect(await ids("diabetes")).toEqual(["NCT00000002"]);
    expect(await ids("heart disease")).toEqual(["NCT00000001"]);
    expect(await ids("myocardial infarctions")).toEqual(["NCT00000001"]);
    expect(await ids("leukemia")).toEqual([]);
  });

  it("treats punctuation in the condition as text, not syntax", async () => {
    await expect(searchTrials(db, { ...DORCHESTER, radiusMi: 60, cond: "'); drop table trials; --" })).resolves.toEqual([]);
    const t = await db.query<{ n: number }>("select count(*)::int as n from trials");
    expect(t.rows[0].n).toBe(3);
  });
});

describe("prune", () => {
  it("removes trials (and their sites) that left the snapshot", async () => {
    const result = await loadRows(db, [toRows(STUDIES[0])!], { prune: true });
    expect(result.pruned).toBe(2);
    const s = await db.query<{ n: number }>("select count(*)::int as n from sites");
    expect(s.rows[0].n).toBe(2);
  });
});
