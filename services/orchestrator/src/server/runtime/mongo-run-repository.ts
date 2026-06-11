// MongoRunRepository — implements Stephen's RunRepository interface against the
// monolith's Mongo RunModel. This is the ONLY place the ported runtime touches
// Mongo; the runtime code calls the interface, unaware of the storage backend.
//
// Run lifecycle: the `runs.create` tRPC mutation already creates the Run doc
// (with graphSnapshot + ownerId), so `createRun` here is a no-op upsert guard;
// the runtime then appends events / updates node state / finishes the run.
import { connectDB } from "@/db/client";
import { RunModel } from "@/db/models";
import { redactSecrets } from "./secret-redaction";
import type {
  CreateRunInput,
  FinishRunInput,
  NodeRunUpdate,
  RunRepository,
} from "./run-repository";
import type { RuntimeEvent } from "./types";

export class MongoRunRepository implements RunRepository {
  async createRun(input: CreateRunInput): Promise<void> {
    await connectDB();
    const ownerId = stringMetadata(input.metadata?.ownerId, "ownerId");
    // The Run doc is normally created by runs.create (with graphSnapshot/owner).
    // If a runtime path creates one directly, ensure it exists.
    const exists = await RunModel.exists({ _id: input.runId, ownerId });
    if (!exists) {
      await RunModel.create({
        _id: input.runId,
        graphId: (input.metadata?.graphId as string) ?? input.runId,
        ownerId,
        graphSnapshot: input.metadata?.graphSnapshot ?? {},
        status: "running",
        startedAt: input.createdAt ?? new Date().toISOString(),
        nodeRuns: new Map(),
      });
    }
  }

  async appendNodeEvent(event: RuntimeEvent, ownerId?: string): Promise<void> {
    await this.appendNodeEventsBatch([event], ownerId);
  }

  async appendNodeEventsBatch(events: RuntimeEvent[], ownerId?: string): Promise<void> {
    await connectDB();
    const scopedOwnerId = requiredOwnerId(ownerId);
    const eventsByNode = new Map<string, RuntimeEvent[]>();

    for (const rawEvent of events) {
      const event = redactSecrets(rawEvent);
      if (!event.nodeId) continue;
      const nodeEvents = eventsByNode.get(event.nodeId) ?? [];
      nodeEvents.push(event);
      eventsByNode.set(event.nodeId, nodeEvents);
    }

    for (const [nodeId, nodeEvents] of eventsByNode) {
      const persistedEvents = nodeEvents.map(toPersistedEvent);
      const runId = nodeEvents[0]!.runId;

      await RunModel.updateOne(
        { _id: runId, ownerId: scopedOwnerId, [`nodeRuns.${nodeId}`]: { $exists: false } },
        {
          $set: {
            [`nodeRuns.${nodeId}`]: {
              nodeId,
              status: "running",
              attempt: 0,
              events: [],
            },
          },
        },
      );

      await RunModel.updateOne(
        { _id: runId, ownerId: scopedOwnerId },
        { $push: { [`nodeRuns.${nodeId}.events`]: { $each: persistedEvents } } },
      );
    }
  }

  async updateNodeRun(
    runId: string,
    nodeId: string,
    update: NodeRunUpdate,
    ownerId?: string,
  ): Promise<void> {
    await connectDB();
    const scopedOwnerId = requiredOwnerId(ownerId);
    const set: Record<string, unknown> = {};
    if (update.status !== undefined) set[`nodeRuns.${nodeId}.status`] = update.status;
    if (update.worktreePath !== undefined) set[`nodeRuns.${nodeId}.worktreePath`] = update.worktreePath;
    if (update.branchName !== undefined) set[`nodeRuns.${nodeId}.branchName`] = update.branchName;
    if (update.output !== undefined) set[`nodeRuns.${nodeId}.outputs`] = redactSecrets(update.output);
    if (update.exitCode !== undefined) set[`nodeRuns.${nodeId}.exitCode`] = update.exitCode;
    if (update.patchLength !== undefined) set[`nodeRuns.${nodeId}.patchLength`] = update.patchLength;
    if (Object.keys(set).length === 0) return;

    await RunModel.updateOne(
      { _id: runId, ownerId: scopedOwnerId, [`nodeRuns.${nodeId}`]: { $exists: false } },
      { $set: { [`nodeRuns.${nodeId}`]: { nodeId, status: "pending", attempt: 0, events: [] } } },
    );
    await RunModel.updateOne({ _id: runId, ownerId: scopedOwnerId }, { $set: set });
  }

  async finishRun(runId: string, input: FinishRunInput, ownerId?: string): Promise<void> {
    await connectDB();
    const scopedOwnerId = requiredOwnerId(ownerId);
    await RunModel.updateOne(
      { _id: runId, ownerId: scopedOwnerId },
      {
        $set: {
          status: input.status,
          finishedAt: input.finishedAt ?? new Date().toISOString(),
        },
      },
    );
  }
}

function toPersistedEvent(event: RuntimeEvent): { ts: string; level: string; payload: Record<string, unknown> } {
  return {
    ts: event.timestamp,
    level: mapLevel(event.type),
    payload: { type: event.type, ...event.payload },
  };
}

function requiredOwnerId(ownerId: string | undefined): string {
  if (!ownerId) {
    throw new Error("ownerId is required for Mongo runtime persistence");
  }
  return ownerId;
}

function stringMetadata(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${field} is required for Mongo runtime persistence`);
}

// Map runtime event types to the NodeRunEvent `level` enum (info/warn/error/tool/stdout/stderr).
function mapLevel(type: RuntimeEvent["type"]): string {
  if (type === "node.stdout") return "stdout";
  if (type === "node.stderr") return "stderr";
  if (type.endsWith(".failed") || type === "node.output_parse_failed") return "error";
  if (type === "node.output" || type === "node.patch") return "tool";
  return "info";
}

export const mongoRunRepository = new MongoRunRepository();
