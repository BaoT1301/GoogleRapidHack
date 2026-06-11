import { describe, expect, it } from "vitest";
import { sseHub } from "./hub";

describe("SSEHub", () => {
  it("delivers emitted events to subscribers and stops after unsubscribe", () => {
    const received: string[] = [];
    const unsub = sseHub.subscribe("run_A", { write: (d) => received.push(d) });

    sseHub.emit("run_A", { hello: "world" });
    expect(received).toHaveLength(1);
    expect(received[0]).toBe('data: {"hello":"world"}\n\n');

    unsub();
    sseHub.emit("run_A", { again: true });
    expect(received).toHaveLength(1); // no delivery after unsubscribe
    expect(sseHub.clientCount("run_A")).toBe(0);
  });

  it("emitToNode reaches BOTH the per-node channel and the run channel", () => {
    const runMsgs: string[] = [];
    const nodeMsgs: string[] = [];
    const unsubRun = sseHub.subscribe("run_B", { write: (d) => runMsgs.push(d) });
    const unsubNode = sseHub.subscribe("run_B:node_1", {
      write: (d) => nodeMsgs.push(d),
    });

    sseHub.emitToNode("run_B", "node_1", { level: "stdout", payload: "hi" });

    expect(nodeMsgs).toHaveLength(1);
    expect(runMsgs).toHaveLength(1);
    // nodeId is attached to the payload
    expect(runMsgs[0]).toContain('"nodeId":"node_1"');
    expect(nodeMsgs[0]).toContain('"payload":"hi"');

    unsubRun();
    unsubNode();
  });
});
