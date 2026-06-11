import { ulid } from "ulid";
import { wouldCreateCycle, type MinEdge } from "@/lib/graph-validation";
import type { INodeSpec, IEdgeSpec } from "@/db/models/graph.model";

/**
 * Map an Architect `GraphSpec` (top-level body, see
 * `.claude/docs/core/api-contracts/architect-plan-api.md`) into canvas
 * `INodeSpec`/`IEdgeSpec` with the locked multi-agent topology:
 *
 *  - `track` → `execute` node (`label = name`; `data.persona/overview/checklist`).
 *  - `dependsOn` → `flow` edge (dependency → dependent); SEQUENTIAL tracks chain
 *    naturally through these edges.
 *  - a `dependsOn` that points back to an ancestor (would create a flow cycle) →
 *    `loop` back-edge (iterate-until-condition) instead of `flow`.
 *  - PARALLEL tracks that fan out from the same dependency set converge into a
 *    `gate` (merge) node.
 *
 * Pure + framework-free so it is unit-tested in isolation (`plan-map.test.ts`).
 */

interface RawTrack {
  id?: unknown;
  number?: unknown;
  execution?: unknown;
  persona?: unknown;
  name?: unknown;
  overview?: unknown;
  checklist?: unknown;
  dependsOn?: unknown;
}

const COL = 260;
const ROW = 140;

/**
 * Synthesize an Execute node's `data.prompt` from the Architect track's detail
 * (overview + checklist) so the generated node carries a real, editable instruction
 * — not just its label. The runtime reads `data.prompt` (prompt-assembly.ts), and
 * the Inspector binds the Prompt field to it. Returns undefined when there's no
 * detail (the runner then falls back to the label).
 */
function trackPrompt(overview: string | undefined, checklist: string[]): string | undefined {
  const parts: string[] = [];
  if (overview && overview.trim()) parts.push(overview.trim());
  if (checklist.length > 0) parts.push(`Checklist:\n${checklist.map((c) => `- ${c}`).join("\n")}`);
  const body = parts.join("\n\n");
  return body.length > 0 ? body : undefined;
}

export function planToGraphSpec(spec: unknown): {
  nodes: INodeSpec[];
  edges: IEdgeSpec[];
} {
  const s = (spec ?? {}) as { tracks?: unknown };
  const rawTracks = Array.isArray(s.tracks) ? (s.tracks as RawTrack[]) : [];

  // 1. One execute node per track. Preserve the track id so dependsOn resolves.
  const idByIndex: string[] = [];
  const nodes: INodeSpec[] = rawTracks.map((t, i) => {
    const number = typeof t.number === "number" ? t.number : i + 1;
    const id = typeof t.id === "string" && t.id ? t.id : ulid();
    idByIndex[i] = id;
    const execution = t.execution === "PARALLEL" ? "PARALLEL" : "SEQUENTIAL";
    const overview = typeof t.overview === "string" ? t.overview : undefined;
    const checklist = Array.isArray(t.checklist)
      ? t.checklist.filter((c): c is string => typeof c === "string")
      : [];
    return {
      id,
      kind: "execute",
      label: typeof t.name === "string" && t.name ? t.name : `Track ${number}`,
      position: { x: 0, y: 0 },
      status: "pending",
      data: {
        persona: typeof t.persona === "string" ? t.persona : undefined,
        // Synthesize the executable prompt from the Architect's track detail so the
        // node isn't blank (the runner + Inspector read data.prompt).
        prompt: trackPrompt(overview, checklist),
        overview,
        checklist,
        number,
        execution,
      },
    };
  });

  const validIds = new Set(nodes.map((n) => n.id));

  // 2. dependsOn → edges. Forward deps are `flow`; a dep that would close a flow
  //    cycle becomes a `loop` back-edge to the ancestor.
  const edges: IEdgeSpec[] = [];
  const flow: MinEdge[] = [];
  rawTracks.forEach((t, i) => {
    const target = idByIndex[i];
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    deps.forEach((dep) => {
      if (typeof dep !== "string" || dep === target || !validIds.has(dep)) return;
      const isLoop = wouldCreateCycle(flow, dep, target);
      edges.push({
        id: ulid(),
        source: dep,
        target,
        kind: isLoop ? "loop" : "flow",
      });
      if (!isLoop) flow.push({ source: dep, target, kind: "flow" });
    });
  });

  // 3. PARALLEL fan-out → gate (merge) node. Group parallel tracks that share the
  //    same dependency signature; each group ≥2 converges into one gate node.
  const parallel = rawTracks
    .map((t, i) => ({ t, id: idByIndex[i] }))
    .filter(({ t }) => t.execution === "PARALLEL");
  const groups = new Map<string, string[]>();
  for (const { t, id } of parallel) {
    const deps = (Array.isArray(t.dependsOn) ? t.dependsOn : [])
      .filter((d): d is string => typeof d === "string" && validIds.has(d))
      .sort();
    const sig = deps.join("|");
    const list = groups.get(sig);
    if (list) list.push(id);
    else groups.set(sig, [id]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const gateId = ulid();
    nodes.push({
      id: gateId,
      kind: "gate",
      label: "Merge",
      position: { x: 0, y: 0 },
      status: "pending",
      data: { gateFor: members },
    });
    for (const m of members) {
      edges.push({ id: ulid(), source: m, target: gateId, kind: "flow" });
      flow.push({ source: m, target: gateId, kind: "flow" });
    }
  }

  layout(nodes, flow);
  return { nodes, edges };
}

/**
 * PLAN-4: map a sprint's plain task-name list into a linear chain of `execute`
 * nodes joined by `flow` edges (task 1 → task 2 → …), reusing the same layered
 * `layout`. Used for the LATER sprints of a multi-sprint plan, which only carry
 * a `tasks: string[]` list (no full `tracks` topology) — see the Architect
 * contract §3b `backlog.sprints[]`. Pure + framework-free (unit-tested).
 *
 * Empty / blank task names are dropped; an empty list yields no nodes/edges.
 */
export function sprintTasksToGraphSpec(tasks: string[]): {
  nodes: INodeSpec[];
  edges: IEdgeSpec[];
} {
  const names = (Array.isArray(tasks) ? tasks : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const nodes: INodeSpec[] = names.map((name, i) => ({
    id: ulid(),
    kind: "execute",
    label: name,
    position: { x: 0, y: 0 },
    status: "pending",
    data: { number: i + 1, execution: "SEQUENTIAL" },
  }));

  const edges: IEdgeSpec[] = [];
  const flow: MinEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const source = nodes[i - 1].id;
    const target = nodes[i].id;
    edges.push({ id: ulid(), source, target, kind: "flow" });
    flow.push({ source, target, kind: "flow" });
  }

  layout(nodes, flow);
  return { nodes, edges };
}

/** Longest-path layered layout over flow edges (loop edges are ignored). */
function layout(nodes: INodeSpec[], flow: MinEdge[]): void {  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // Relax depths until stable (DAG over flow edges → ≤ |nodes| passes).
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of flow) {
      const next = (depth.get(e.source) ?? 0) + 1;
      if (next > (depth.get(e.target) ?? 0)) {
        depth.set(e.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rowAt = new Map<number, number>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const row = rowAt.get(d) ?? 0;
    rowAt.set(d, row + 1);
    n.position = { x: d * COL, y: row * ROW };
  }
}
