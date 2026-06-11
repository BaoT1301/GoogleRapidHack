import { describe, it, expect, vi } from "vitest";
import { embedWithCache } from "./embed-cache";

/** Deterministic fake embedder: vector = [len, charCodeOf(first)]. Records calls. */
function fakeEmbedder() {
  const calls: string[][] = [];
  const fn = vi.fn(async (texts: string[]) => {
    calls.push(texts);
    return texts.map((t) => [t.length, t.charCodeAt(0) || 0]);
  });
  return { fn, calls };
}

describe("embedWithCache", () => {
  it("embeds everything on a cold cache (no previous doc)", async () => {
    const { fn } = fakeEmbedder();
    const res = await embedWithCache({
      symbols: ["a", "bb", "ccc"],
      model: "m1",
      embedder: fn,
    });
    expect(res.embedded).toBe(3);
    expect(res.reused).toBe(0);
    expect(res.vectors).toHaveLength(3);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(["a", "bb", "ccc"]);
  });

  it("reuses cached vectors for unchanged symbols, only embeds the new ones", async () => {
    const { fn, calls } = fakeEmbedder();
    const res = await embedWithCache({
      symbols: ["a", "bb", "NEW"], // "a","bb" unchanged; "NEW" is new
      prevSymbols: ["a", "bb", "old"],
      prevVectors: [[9, 9], [8, 8], [7, 7]],
      prevModel: "m1",
      model: "m1",
      embedder: fn,
    });
    expect(res.reused).toBe(2);
    expect(res.embedded).toBe(1);
    // Only the miss was embedded.
    expect(calls).toEqual([["NEW"]]);
    // Reused vectors are the previous ones, in the new order; the miss is freshly embedded.
    expect(res.vectors[0]).toEqual([9, 9]);
    expect(res.vectors[1]).toEqual([8, 8]);
    expect(res.vectors[2]).toEqual([3, 78]); // "NEW".length=3, 'N'=78
  });

  it("invalidates the whole cache when the embedding model changed", async () => {
    const { fn } = fakeEmbedder();
    const res = await embedWithCache({
      symbols: ["a", "bb"],
      prevSymbols: ["a", "bb"],
      prevVectors: [[9, 9], [8, 8]],
      prevModel: "OLD-MODEL",
      model: "NEW-MODEL",
      embedder: fn,
    });
    expect(res.reused).toBe(0);
    expect(res.embedded).toBe(2);
    expect(fn).toHaveBeenCalledWith(["a", "bb"]);
  });

  it("does not call the embedder at all when everything is cached", async () => {
    const { fn } = fakeEmbedder();
    const res = await embedWithCache({
      symbols: ["a", "bb"],
      prevSymbols: ["a", "bb"],
      prevVectors: [[9, 9], [8, 8]],
      prevModel: "m1",
      model: "m1",
      embedder: fn,
    });
    expect(res.embedded).toBe(0);
    expect(res.reused).toBe(2);
    expect(fn).not.toHaveBeenCalled();
    expect(res.vectors).toEqual([[9, 9], [8, 8]]);
  });

  it("tolerates a previous doc with fewer vectors than symbols (capped prefix)", async () => {
    const { fn } = fakeEmbedder();
    const res = await embedWithCache({
      symbols: ["a", "bb", "ccc"],
      prevSymbols: ["a", "bb", "ccc"],
      prevVectors: [[9, 9]], // only the first was vectorized last time
      prevModel: "m1",
      model: "m1",
      embedder: fn,
    });
    expect(res.reused).toBe(1); // only "a" had a cached vector
    expect(res.embedded).toBe(2); // "bb","ccc" embedded
    expect(calls_first(fn)).toEqual(["bb", "ccc"]);
  });
});

function calls_first(fn: ReturnType<typeof vi.fn>): unknown {
  return fn.mock.calls[0]?.[0];
}
