import type { RuntimeEvent, RuntimeStatus } from "../runtime/types";

export interface CreateRunInput {
  runId: string;
  source: "debug" | "graph";
  nodeIds: string[];
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface NodeRunUpdate {
  status?: RuntimeStatus;
  worktreePath?: string;
  branchName?: string;
  exitCode?: number | null;
  output?: unknown;
  patchLength?: number;
}

export interface FinishRunInput {
  status: "success" | "failed" | "cancelled";
  finishedAt?: string;
  payload?: Record<string, unknown>;
}

export interface StoredRun {
  runId: string;
  source: CreateRunInput["source"];
  status: "running" | FinishRunInput["status"];
  nodeIds: string[];
  createdAt: string;
  finishedAt?: string;
  metadata: Record<string, unknown>;
  events: RuntimeEvent[];
  nodeRuns: Record<string, NodeRunUpdate>;
  result?: Record<string, unknown>;
}

export interface RunRepository {
  createRun(input: CreateRunInput): Promise<void> | void;
  appendNodeEvent(event: RuntimeEvent, ownerId?: string): Promise<void> | void;
  appendNodeEventsBatch(events: RuntimeEvent[], ownerId?: string): Promise<void> | void;
  updateNodeRun(
    runId: string,
    nodeId: string,
    update: NodeRunUpdate,
    ownerId?: string
  ): Promise<void> | void;
  finishRun(runId: string, input: FinishRunInput, ownerId?: string): Promise<void> | void;
}

export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, StoredRun>();

  createRun(input: CreateRunInput): void {
    if (this.runs.has(input.runId)) {
      throw new Error(`Run already exists: ${input.runId}`);
    }

    this.runs.set(input.runId, {
      runId: input.runId,
      source: input.source,
      status: "running",
      nodeIds: [...input.nodeIds],
      createdAt: input.createdAt ?? new Date().toISOString(),
      metadata: { ...input.metadata },
      events: [],
      nodeRuns: {}
    });
  }

  appendNodeEvent(event: RuntimeEvent): void {
    this.appendNodeEventsBatch([event]);
  }

  appendNodeEventsBatch(events: RuntimeEvent[]): void {
    if (events.length === 0) return;
    const run = this.requireRun(events[0]!.runId);
    run.events.push(...events);
  }

  updateNodeRun(runId: string, nodeId: string, update: NodeRunUpdate): void {
    const run = this.requireRun(runId);
    run.nodeRuns[nodeId] = {
      ...run.nodeRuns[nodeId],
      ...update
    };
  }

  finishRun(runId: string, input: FinishRunInput): void {
    const run = this.requireRun(runId);
    run.status = input.status;
    run.finishedAt = input.finishedAt ?? new Date().toISOString();
    run.result = input.payload ? { ...input.payload } : undefined;
  }

  getRun(runId: string): StoredRun | undefined {
    return this.runs.get(runId);
  }

  private requireRun(runId: string): StoredRun {
    const run = this.runs.get(runId);

    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    return run;
  }
}
