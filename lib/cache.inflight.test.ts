// Concurrent cold requests for the same key share one fetch when they opt in with
// `shareInFlight` (PR #33 review follow-up).
import { describe, expect, it, vi } from "vitest";
import { cachedFetchJson } from "./cache";

const SHARE = { shareInFlight: true };

let counter = 0;
const k = (label: string) => `inflight-${label}:${counter++}`;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("cachedFetchJson — in-flight sharing", () => {
  it("calls the fetcher once for concurrent misses and gives every caller its value", async () => {
    const key = k("ok");
    const d = deferred<{ n: number }>();
    const fetcher = vi.fn(() => d.promise);

    const calls = [cachedFetchJson(key, fetcher, 1, SHARE), cachedFetchJson(key, fetcher, 1, SHARE)];
    d.resolve({ n: 7 });

    expect(await Promise.all(calls)).toEqual([{ n: 7 }, { n: 7 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("gives every waiting caller the same error, then lets a later call try again", async () => {
    const key = k("err");
    const d = deferred<{ n: number }>();
    const failing = vi.fn(() => d.promise);

    const calls = [cachedFetchJson(key, failing, 1, SHARE), cachedFetchJson(key, failing, 1, SHARE)];
    d.reject(new Error("down"));
    const results = await Promise.allSettled(calls);

    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(failing).toHaveBeenCalledTimes(1);

    const retry = vi.fn(async () => ({ n: 8 }));
    expect(await cachedFetchJson(key, retry, 2, SHARE)).toEqual({ n: 8 });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does not share between different keys", async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }));
    await Promise.all([cachedFetchJson(k("a"), fetcher, 1, SHARE), cachedFetchJson(k("b"), fetcher, 1, SHARE)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("cachedFetchJson — in-flight sharing, second review round", () => {
  it("a fetcher that throws synchronously does not poison later calls for the key", async () => {
    const key = k("sync-throw");
    const boom = () => {
      throw new Error("sync boom");
    };
    await expect(
      cachedFetchJson(key, boom as unknown as () => Promise<string>, 1, SHARE),
    ).rejects.toThrow("sync boom");

    await expect(cachedFetchJson(key, async () => "fresh", 2, SHARE)).resolves.toBe("fresh");
  });

  it("callers that do not opt in never join an in-flight fetch (own deadline, own error)", async () => {
    const key = k("no-share");
    const d = deferred<string>();
    const slow = vi.fn(() => d.promise);
    const shared = cachedFetchJson(key, slow, 1, SHARE);

    // A caller with its own (say, shorter) deadline gets its own fetcher and its own error.
    const own = vi.fn(async () => {
      throw new Error("own timeout");
    });
    await expect(cachedFetchJson(key, own, 1)).rejects.toThrow("own timeout");
    expect(own).toHaveBeenCalledTimes(1);

    d.resolve("slow value");
    await expect(shared).resolves.toBe("slow value");
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("without shareInFlight, concurrent misses each call their own fetcher", async () => {
    const key = k("default");
    const a = vi.fn(async () => "a");
    const b = vi.fn(async () => "b");
    expect(await Promise.all([cachedFetchJson(key, a, 1), cachedFetchJson(key, b, 1)])).toEqual([
      "a",
      "b",
    ]);
  });
});
