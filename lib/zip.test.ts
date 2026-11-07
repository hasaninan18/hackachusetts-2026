// Tests for the national ZIP lookup (lib/zip.ts) against the real generated shards in
// public/zcta/ — read from disk, NO network.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import maZips from "./ma-zips.json";
import { REGIONS } from "./region";
import { clearZipCache, isZipFormat, lookupZip, resolveZip } from "./zip";

const SHARD_DIR = join(process.cwd(), "public", "zcta");

async function diskShard(prefix: string) {
  try {
    return JSON.parse(readFileSync(join(SHARD_DIR, `${prefix}.json`), "utf8"));
  } catch {
    return null;
  }
}

beforeEach(() => clearZipCache());

describe("isZipFormat", () => {
  it("accepts exactly five digits", () => {
    expect(isZipFormat("02124")).toBe(true);
    for (const bad of ["", "2124", "021245", "02l24", " 02124", "02124-1234"]) {
      expect(isZipFormat(bad)).toBe(false);
    }
  });
});

describe("lookupZip with real shards", () => {
  it("finds Dorchester at the same centroid as the old MA table", async () => {
    const r = await lookupZip("02124", REGIONS.ma, diskShard);
    expect(r).toEqual({ kind: "ok", lat: 42.2859, lon: -71.075, state: "MA" });
  });

  it("matches every ZIP in lib/ma-zips.json for the ma region", async () => {
    const table = maZips as unknown as Record<string, [number, number]>;
    for (const [zip, [lat, lon]] of Object.entries(table)) {
      const r = await lookupZip(zip, REGIONS.ma, diskShard);
      expect(r).toEqual({ kind: "ok", lat, lon, state: "MA" });
    }
  });

  it("says outside for a real ZIP in another state, and ok once the region covers it", async () => {
    expect(await lookupZip("77030", REGIONS.ma, diskShard)).toEqual({ kind: "outside", state: "TX" });
    const houston = await lookupZip("77030", REGIONS.us, diskShard);
    expect(houston.kind).toBe("ok");
    expect(await lookupZip("02903", REGIONS["new-england"], diskShard)).toMatchObject({ kind: "ok", state: "RI" });
  });

  it("treats Puerto Rico as outside every region (not a state in REGIONS)", async () => {
    expect(await lookupZip("00601", REGIONS.us, diskShard)).toEqual({ kind: "outside", state: "PR" });
  });

  it("says unknown for a well-formed ZIP that is not a residential ZIP area", async () => {
    // 05501 is an Andover, MA PO-box ZIP; 000xx has no shard at all.
    expect(await lookupZip("05501", REGIONS.ma, diskShard)).toEqual({ kind: "unknown" });
    expect(await lookupZip("00001", REGIONS.us, diskShard)).toEqual({ kind: "unknown" });
  });

  it("says invalid without fetching for a malformed ZIP", async () => {
    let calls = 0;
    const r = await lookupZip("abc", REGIONS.us, async () => {
      calls++;
      return null;
    });
    expect(r).toEqual({ kind: "invalid" });
    expect(calls).toBe(0);
  });
});

describe("lookupZip caching and errors", () => {
  it("fetches each prefix once", async () => {
    const seen: string[] = [];
    const fetcher = async (p: string) => {
      seen.push(p);
      return diskShard(p);
    };
    await lookupZip("02124", REGIONS.ma, fetcher);
    await lookupZip("02125", REGIONS.ma, fetcher);
    await lookupZip("02215", REGIONS.ma, fetcher);
    expect(seen).toEqual(["021", "022"]);
  });

  it("returns error on a failed fetch and retries next time", async () => {
    let fail = true;
    const fetcher = async (p: string) => {
      if (fail) throw new Error("offline");
      return diskShard(p);
    };
    expect(await lookupZip("02124", REGIONS.ma, fetcher)).toEqual({ kind: "error" });
    fail = false;
    expect((await lookupZip("02124", REGIONS.ma, fetcher)).kind).toBe("ok");
  });
});

describe("resolveZip", () => {
  it("ignores prototype keys in a shard", () => {
    expect(resolveZip("00000", {}, REGIONS.us)).toEqual({ kind: "unknown" });
    expect(resolveZip("02124", null, REGIONS.us)).toEqual({ kind: "unknown" });
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...Object.values(REGIONS)), (zip, region) => {
        expect(typeof resolveZip(zip, { [zip]: [1, 2, "MA"] }, region).kind).toBe("string");
      }),
    );
  });
});

describe("generated shards", () => {
  const files = readdirSync(SHARD_DIR).filter((f) => f.endsWith(".json"));

  it("cover all 50 states and DC", () => {
    const states = new Set<string>();
    for (const f of files) {
      for (const [, , s] of Object.values(JSON.parse(readFileSync(join(SHARD_DIR, f), "utf8"))) as [number, number, string][]) {
        states.add(s);
      }
    }
    for (const code of REGIONS.us.states) expect(states.has(code)).toBe(true);
  });

  it("only hold ZIPs matching their file's prefix, with US-range coordinates", () => {
    for (const f of files) {
      const prefix = f.slice(0, 3);
      const shard = JSON.parse(readFileSync(join(SHARD_DIR, f), "utf8")) as Record<string, [number, number, string]>;
      for (const [zip, [lat, lon]] of Object.entries(shard)) {
        expect(zip.startsWith(prefix)).toBe(true);
        // Covers Hawaii, Alaska's Aleutians (crossing 180°) and Puerto Rico.
        expect(lat).toBeGreaterThan(17);
        expect(lat).toBeLessThan(72);
        expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      }
    }
  });
});
