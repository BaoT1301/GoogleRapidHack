import { z } from "zod";
import {
  NODE_KINDS,
  NODE_STATUSES,
  EDGE_KINDS,
  type INodeSpec,
  type IEdgeSpec,
} from "./graph.model";

/**
 * MODEL-1 — typed zod schemas for `INodeSpec`/`IEdgeSpec`, mirroring the Mongoose
 * model EXACTLY so the tRPC `graphs.create`/`graphs.update` boundary rejects
 * malformed graphs without breaking valid canvas saves.
 *
 * Single source of truth: the enums are imported from `graph.model.ts`
 * (`NODE_KINDS`/`NODE_STATUSES`/`EDGE_KINDS`) — the schemas can never drift from
 * the model (same pattern as CLI-2's `SUPPORTED_CLIS` sync). The `_satisfies`
 * checks below fail to compile if the zod output stops matching the model types.
 *
 * Tolerance notes (must NOT reject `lib/graph-io` / canvas-`serialize` saves):
 *   - `position` is optional (model defaults x/y → 0); x/y default to 0.
 *   - `status` defaults to "pending" (model default).
 *   - `data` is a passthrough record (`INodeSpec.data` is `Record<string,unknown>`).
 *   - optional fields tolerate an explicit `undefined` (superjson round-trips it).
 *   - unknown top-level keys are stripped (zod default), matching Mongoose
 *     subdocument behavior — node-specific fields belong inside `data`.
 */

const PositionZ = z
  .object({
    x: z.number().default(0),
    y: z.number().default(0),
  })
  .default({ x: 0, y: 0 });

export const NodeSpecZ = z
  .object({
    id: z.string().min(1),
    kind: z.enum(NODE_KINDS),
    label: z.string(),
    position: PositionZ.optional(),
    status: z.enum(NODE_STATUSES).default("pending"),
    notes: z.string().optional(),
    data: z.record(z.unknown()).default({}),
  })
  // SKILL-1: `data.skills?` is an additive, optional `string[]` (attached skill
  // ids). Validated tolerantly — absent/array-of-strings pass; a malformed
  // `skills` (present but not a string[]) is rejected. Existing graphs (no
  // `skills` key) are unaffected.
  .superRefine((node, ctx) => {
    const skills = (node.data as Record<string, unknown>)?.skills;
    if (skills === undefined) return;
    if (
      !Array.isArray(skills) ||
      !skills.every((s) => typeof s === "string")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "skills"],
        message: "data.skills must be an array of strings",
      });
    }
  });

export const EdgeSpecZ = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: z.enum(EDGE_KINDS),
  outputKey: z.string().optional(),
  inputKey: z.string().optional(),
  fanInMode: z.enum(["all-of", "any-of"]).optional(),
});

export type NodeSpecInput = z.infer<typeof NodeSpecZ>;
export type EdgeSpecInput = z.infer<typeof EdgeSpecZ>;

// Compile-time drift guards: the validated output must remain assignable to the
// model interfaces (so the schema and the Mongoose model can never disagree).
const _nodeSatisfies = (n: NodeSpecInput): INodeSpec => ({
  id: n.id,
  kind: n.kind,
  label: n.label,
  position: n.position ?? { x: 0, y: 0 },
  status: n.status,
  notes: n.notes,
  data: n.data,
});
const _edgeSatisfies = (e: EdgeSpecInput): IEdgeSpec => ({
  id: e.id,
  source: e.source,
  target: e.target,
  kind: e.kind,
  outputKey: e.outputKey,
  inputKey: e.inputKey,
  fanInMode: e.fanInMode,
});
void _nodeSatisfies;
void _edgeSatisfies;
