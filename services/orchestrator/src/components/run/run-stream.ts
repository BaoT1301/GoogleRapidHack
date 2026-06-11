import type { RuntimeEvent } from "@/lib/run-events";

export type RunEventHandler = (e: RuntimeEvent) => void;

/**
 * Real subscription: same-origin SSE (cookie rides along). Parses each
 * `data:` frame as a contract RuntimeEvent. Returns an unsubscribe fn.
 */
export function subscribeToRun(
  runId: string,
  onEvent: RunEventHandler,
  onOpen?: () => void,
  onError?: () => void,
): () => void {
  const params = new URLSearchParams();
  const devUser = process.env.NEXT_PUBLIC_DEV_AUTH_USER;
  if (
    process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === "1" &&
    process.env.NODE_ENV !== "production" &&
    devUser
  ) {
    params.set("dev_user", devUser);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const es = new EventSource(`/api/runs/${runId}/events${suffix}`);
  if (onOpen) {
    // Resolve once the stream is actually connected — fast runs can finish in
    // <300ms, before a late subscriber attaches, so we'd miss every event.
    // 800ms fallback in case `onopen` is flaky.
    let fired = false;
    let failed = false;
    const fire = () => {
      if (!fired && !failed) {
        fired = true;
        onOpen();
      }
    };
    es.addEventListener("open", fire);
    es.addEventListener("error", () => {
      failed = true;
      onError?.();
    });
    const fallback = setTimeout(fire, 800);
    es.addEventListener("open", () => clearTimeout(fallback), { once: true });
  }
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as RuntimeEvent);
    } catch {
      /* ignore keepalive / non-JSON frames */
    }
  };
  return () => es.close();
}

export interface FakeNode {
  id: string;
  label?: string;
}

/**
 * Dev-only fake event source. Replays contract-shaped events for the given
 * execute nodes so the viewer is demoable before the Phase 4.9 runtime lands.
 * 1:1 swappable with `subscribeToRun` (same `RuntimeEvent` envelope + handler).
 */
export function subscribeToFakeRun(
  runId: string,
  nodes: FakeNode[],
  onEvent: RunEventHandler,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const emit = (
    ms: number,
    type: string,
    nodeId?: string,
    payload: Record<string, unknown> = {},
  ) =>
    timers.push(
      setTimeout(
        () =>
          onEvent({
            type,
            runId,
            nodeId,
            timestamp: new Date().toISOString(),
            payload,
          }),
        ms,
      ),
    );

  emit(0, "run.started");
  let end = 200;
  nodes.forEach((n, i) => {
    const b = 150 + i * 180;
    const tag = n.label ?? n.id;
    emit(b, "node.queued", n.id);
    emit(b + 150, "node.worktree.created", n.id, {
      worktreePath: `.orchestrator/worktrees/${runId}/${n.id}`,
      branchName: `agent/${runId}/${n.id}`,
    });
    emit(b + 320, "node.running", n.id);
    emit(b + 480, "node.stdout", n.id, { line: `[${tag}] starting task` });
    emit(b + 760, "node.stdout", n.id, { line: `[${tag}] applying changes` });
    emit(b + 1000, "node.patch", n.id, {
      patchLength: 248,
      patchPreview: `diff --git a/${n.id}.ts b/${n.id}.ts`,
    });
    emit(b + 1180, "node.output", n.id, {
      output: { summary: `${tag} complete`, filesChanged: 2 },
    });
    emit(b + 1320, "node.completed", n.id);
    end = b + 1500;
  });
  emit(end, "run.completed");

  return () => timers.forEach(clearTimeout);
}
