/**
 * In-process SSE event bus. Stephen's runner calls `emit`/`emitToNode` for each
 * agent stdout line; the SSE route handler subscribes and streams to the browser.
 *
 * globalThis singleton → survives Next HMR (dev) and is one instance under
 * `next start` (prod/Electron), shared between the runtime and the route handler.
 */
export interface SSEClient {
  write: (data: string) => void;
}

class SSEHub {
  private channels = new Map<string, Set<SSEClient>>();

  subscribe(channel: string, client: SSEClient): () => void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(client);
    return () => {
      const s = this.channels.get(channel);
      if (!s) return;
      s.delete(client);
      if (s.size === 0) this.channels.delete(channel);
    };
  }

  private publish(channel: string, event: unknown): void {
    const set = this.channels.get(channel);
    if (!set || set.size === 0) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of set) {
      try {
        client.write(data);
      } catch {
        // client gone — cleaned up on its own unsubscribe/abort
      }
    }
  }

  /** Run-level stream (all events for a run). */
  emit(runId: string, event: unknown): void {
    this.publish(runId, event);
  }

  /**
   * Node-level event. Published to BOTH the per-node channel `${runId}:${nodeId}`
   * AND the run channel (with nodeId attached) — so the run-level stream sees node
   * events too. (Fixes the channel-key mismatch flagged in the Opus-plan review.)
   */
  emitToNode(runId: string, nodeId: string, event: Record<string, unknown>): void {
    const withNode = { ...event, nodeId };
    this.publish(`${runId}:${nodeId}`, withNode);
    this.publish(runId, withNode);
  }

  channelKey(runId: string, nodeId?: string): string {
    return nodeId ? `${runId}:${nodeId}` : runId;
  }

  clientCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }
}

const globalForSse = globalThis as unknown as { __orchestratorSseHub?: SSEHub };
export const sseHub: SSEHub =
  globalForSse.__orchestratorSseHub ?? new SSEHub();
globalForSse.__orchestratorSseHub = sseHub;

export type { SSEHub };
