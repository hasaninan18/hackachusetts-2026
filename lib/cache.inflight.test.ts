// Concurrent cold requests for the same key share one fetch (PR #33 review follow-up).
import { describe, expect, it, vi } from "vitest";
import { cachedFetchJson } from "./cache";

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

    const calls = [cachedFetchJson(key, fetcher, 1), cachedFetchJson(key, fetcher, 1)];
    d.resolve({ n: 7 });

    expect(await Promise.all(calls)).toEqual([{ n: 7 }, { n: 7 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("gives every waiting caller the same error, then lets a later call try again", async () => {
    const key = k("err");
    const d = deferred<{ n: number }>();
    const failing = vi.fn(() => d.promise);

    const calls = [cachedFetchJson(key, failing, 1), cachedFetchJson(key, failing, 1)];
    d.reject(new Error("down"));
    const results = await Promise.allSettled(calls);

    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(failing).toHaveBeenCalledTimes(1);

    const retry = vi.fn(async () => ({ n: 8 }));
    expect(await cachedFetchJson(key, retry, 2)).toEqual({ n: 8 });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does not share between different keys", async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }));
    await Promise.all([cachedFetchJson(k("a"), fetcher, 1), cachedFetchJson(k("b"), fetcher, 1)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
