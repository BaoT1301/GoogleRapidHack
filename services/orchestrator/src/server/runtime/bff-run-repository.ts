// BffRunRepository — the runtime's RunRepository when BFF_URL is set (Cloud Infra
// P0-full). Execution stays LOCAL; this persists run state to the cloud BFF over the
// SERVICE path (BffRunGateway → svc.runs.*), passing the run's ownerId. Per-line
// events would be far too chatty for a cloud round-trip, so appendNodeEvent BUFFERS
// per node and flushes on a short debounce / size cap (and a final flush on
// finishRun) — the contract's batched-persistence design (auth-bff-api.md §5). SSE
// stays local + real-time in the orchestrator; only durable persistence is batched.
import type { RunGateway, RunEventInput } from "@/server/data/run-gateway";
import type {
  CreateRunInput,
  FinishRunInput,
  NodeRunUpdate,
  RunRepository,
} from "./run-repository";
import type { RuntimeEvent } from "./types";

const FLUSH_DEBOUNCE_MS = 250;
const FLUSH_MAX_BATCH = 25;

function mapLevel(type: RuntimeEvent["type"]): string {
  if (type === "node.stdout") return "stdout";
  if (type === "node.stderr") return "stderr";
  if (type.endsWith(".failed") || type === "node.output_parse_failed") return "error";
  if (type === "node.output" || type === "node.patch") return "tool";
  return "info";
}

export class BffRunRepository implements RunRepository {
  private readonly buffers = new Map<string, RunEventInput[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Per-node flush chain so batches persist in order even if flushes overlap.
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly gateway: RunGateway,
    private readonly ownerId: string,
  ) {}

  // The Run doc is created by runs.create / startRunForGraph (through the gateway),
  // so the runtime path is a no-op (mirrors MongoRunRepository's ensure-guard).
  createRun(_input: CreateRunInput): void {}

  appendNodeEvent(event: RuntimeEvent): void {
    if (!event.nodeId) return; // run-level events aren't stored per-node
    const runId = event.runId;
    const nodeId = event.nodeId;
    const key = `${runId}:${nodeId}`;
    const ev: RunEventInput = {
      ts: event.timestamp ?? new Date().toISOString(),
      level: mapLevel(event.type),
      payload: { type: event.type, ...(event.payload as Record<string, unknown>) },
    };
    const buf = this.buffers.get(key) ?? [];
    buf.push(ev);
    this.buffers.set(key, buf);

    if (buf.length >= FLUSH_MAX_BATCH) {
      this.flush(runId, nodeId);
      return;
    }
    if (!this.timers.has(key)) {
      this.timers.set(key, setTimeout(() => this.flush(runId, nodeId), FLUSH_DEBOUNCE_MS));
    }
  }

  // Batch variant required by the RunRepository interface (terminal/runtime branch).
  // Reuses the same per-node buffering/flush path as appendNodeEvent.
  appendNodeEventsBatch(events: RuntimeEvent[]): void {
    for (const event of events) this.appendNodeEvent(event);
  }

  async updateNodeRun(runId: string, nodeId: string, update: NodeRunUpdate): Promise<void> {
    // Flush pending events first so ordering vs. the status change is sane.
    await this.flush(runId, nodeId);
    const fields: Record<string, unknown> = {};
    if (update.status !== undefined) fields.status = update.status;
    if (update.worktreePath !== undefined) fields.worktreePath = update.worktreePath;
    if (update.branchName !== undefined) fields.branchName = update.branchName;
    if (update.output !== undefined) fields.outputs = update.output;
    if (update.exitCode !== undefined) fields.exitCode = update.exitCode;
    if (Object.keys(fields).length === 0) return;
    await this.gateway.patchNodeRun(this.ownerId, runId, nodeId, fields);
  }

  async finishRun(runId: string, input: FinishRunInput): Promise<void> {
    await this.flushAll(runId);
    await this.gateway.updateStatus(
      this.ownerId,
      runId,
      input.status,
      input.finishedAt ?? new Date().toISOString(),
    );
  }

  /** Flush one node's buffered events through the per-node ordering chain. */
  private flush(runId: string, nodeId: string): Promise<void> {
    const key = `${runId}:${nodeId}`;
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    const batch = this.buffers.get(key);
    if (!batch || batch.length === 0) return this.chains.get(key) ?? Promise.resolve();
    this.buffers.set(key, []);
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev
      .then(() => this.gateway.appendEventsBatch(this.ownerId, runId, nodeId, batch))
      .then(() => undefined)
      .catch(() => undefined); // best-effort: a persistence hiccup never crashes a run
    this.chains.set(key, next);
    return next;
  }

  /** Flush every buffered node for a run (used on finish). */
  private async flushAll(runId: string): Promise<void> {
    const prefix = `${runId}:`;
    const nodeIds = [...this.buffers.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
    await Promise.all(nodeIds.map((nodeId) => this.flush(runId, nodeId)));
  }
}
