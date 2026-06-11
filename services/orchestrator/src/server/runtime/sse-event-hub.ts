// SSE shim — bridges Stephen's runtime to the monolith's sseHub.
//
// The ported runtime calls `sseEventHub.publish(runId, event)` (originally a
// Fastify-based hub). In the monolith we forward those events to Bao's
// `sseHub` (@/server/sse/hub), which the Next SSE route streams to the browser.
// Keeping the same `sseEventHub.publish(...)` surface means the runtime code is
// unchanged.
import { sseHub } from "@/server/sse/hub";
import { redactSecrets } from "./secret-redaction";
import type { RuntimeEvent } from "./types";

class RuntimeSseBridge {
  publish(runId: string, event: RuntimeEvent): void {
    // Scrub any known secret value before it can be streamed (partial SEC-2).
    const safe = redactSecrets(event);
    // Per-node events go to the node channel + the run channel; run-level
    // events (no nodeId) go to the run channel only.
    if (safe.nodeId) {
      sseHub.emitToNode(runId, safe.nodeId, safe as unknown as Record<string, unknown>);
    } else {
      sseHub.emit(runId, safe);
    }
  }
}

export const sseEventHub = new RuntimeSseBridge();
export type { RuntimeSseBridge };
