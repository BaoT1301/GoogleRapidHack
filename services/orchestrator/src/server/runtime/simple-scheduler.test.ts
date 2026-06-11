import { describe, expect, it } from "vitest";
import { runSimpleScheduler } from "./simple-scheduler";

interface TestNode {
  id: string;
}

describe("runSimpleScheduler", () => {
  it("runs independent nodes in parallel logically", async () => {
    const started: string[] = [];
    let releaseA: () => void = () => undefined;
    let releaseB: () => void = () => undefined;
    const aDone = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const bDone = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    const runPromise = runSimpleScheduler<TestNode, { ok: boolean }>({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [],
      isSuccessfulResult: (result) => result.ok,
      runNode: async (node) => {
        started.push(node.id);

        if (node.id === "a") {
          await aDone;
        } else {
          await bDone;
        }

        return { ok: true };
      }
    });

    await waitForMicrotasks();
    expect(started).toEqual(["a", "b"]);

    releaseA();
    releaseB();

    const results = await runPromise;
    expect(results.map((result) => result.status)).toEqual(["success", "success"]);
  });

  it("respects A to B flow dependency", async () => {
    const order: string[] = [];

    const results = await runSimpleScheduler<TestNode, { ok: boolean }>({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ source: "a", target: "b", kind: "flow" }],
      isSuccessfulResult: (result) => result.ok,
      runNode: async (node) => {
        order.push(node.id);
        return { ok: true };
      }
    });

    expect(order).toEqual(["a", "b"]);
    expect(results.map((result) => [result.node.id, result.status])).toEqual([
      ["a", "success"],
      ["b", "success"]
    ]);
  });

  it("skips downstream nodes when upstream fails", async () => {
    const skipped: Array<{ id: string; reason: string }> = [];

    const results = await runSimpleScheduler<TestNode, { ok: boolean }>({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ source: "a", target: "b", kind: "flow" }],
      isSuccessfulResult: (result) => result.ok,
      onNodeSkipped: (node, reason) => skipped.push({ id: node.id, reason }),
      runNode: async (node) => ({
        ok: node.id !== "a"
      })
    });

    expect(results.map((result) => [result.node.id, result.status])).toEqual([
      ["a", "failed"],
      ["b", "skipped"]
    ]);
    expect(skipped).toEqual([
      {
        id: "b",
        reason: "Dependency a did not complete successfully"
      }
    ]);
  });
  it("any-of node runs when at least one upstream succeeds (others may fail)", async () => {
    const ran: string[] = [];
    const skipped: string[] = [];

    const results = await runSimpleScheduler<TestNode, { ok: boolean }>({
      nodes: [{ id: "a" }, { id: "b" }, { id: "g" }],
      edges: [
        { source: "a", target: "g", kind: "flow" },
        { source: "b", target: "g", kind: "flow" },
      ],
      isSuccessfulResult: (result) => result.ok,
      getFanInMode: (node) => (node.id === "g" ? "any-of" : "all-of"),
      onNodeSkipped: (node) => skipped.push(node.id),
      runNode: async (node) => {
        ran.push(node.id);
        return { ok: node.id !== "b" }; // b fails, a + g succeed
      },
    });

    // g ran (any-of tolerated b's failure) and was not skipped.
    expect(ran).toContain("g");
    expect(skipped).not.toContain("g");
    const gateResult = results.find((r) => r.node.id === "g");
    expect(gateResult?.status).toBe("success");
    // g ran only after a and b had both settled.
    expect(ran.indexOf("g")).toBeGreaterThan(ran.indexOf("a"));
    expect(ran.indexOf("g")).toBeGreaterThan(ran.indexOf("b"));
  });

  it("any-of node is skipped only when ALL upstreams fail", async () => {
    const ran: string[] = [];
    const skipped: string[] = [];

    const results = await runSimpleScheduler<TestNode, { ok: boolean }>({
      nodes: [{ id: "a" }, { id: "b" }, { id: "g" }],
      edges: [
        { source: "a", target: "g", kind: "flow" },
        { source: "b", target: "g", kind: "flow" },
      ],
      isSuccessfulResult: (result) => result.ok,
      getFanInMode: (node) => (node.id === "g" ? "any-of" : "all-of"),
      onNodeSkipped: (node) => skipped.push(node.id),
      runNode: async (node) => {
        ran.push(node.id);
        return { ok: false }; // everything fails
      },
    });

    expect(ran).not.toContain("g");
    expect(skipped).toContain("g");
    expect(results.find((r) => r.node.id === "g")?.status).toBe("skipped");
  });
});

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
