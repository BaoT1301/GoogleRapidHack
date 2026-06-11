import type { NodeKind, EdgeKind } from "@/db/models/graph.model";

// Client-safe mirror of the graph.model enums (type-only import → no mongoose in
// the bundle). `satisfies` rejects invented values; the _Check guards below fail
// to compile if the model adds a kind we don't mirror (Do-Not-Invent / no drift).
export const NODE_KINDS = [
  "plan",
  "execute",
  "review",
  "doc",
  "gate",
  "context",
  "loop",
] as const satisfies readonly NodeKind[];

export const EDGE_KINDS = [
  "flow",
  "data",
  "attaches-to",
  "loop",
] as const satisfies readonly EdgeKind[];

type _CheckNodeKinds =
  Exclude<NodeKind, (typeof NODE_KINDS)[number]> extends never
    ? true
    : ["graph-constants out of sync with NodeKind"];
type _CheckEdgeKinds =
  Exclude<EdgeKind, (typeof EDGE_KINDS)[number]> extends never
    ? true
    : ["graph-constants out of sync with EdgeKind"];
const _ck: _CheckNodeKinds = true;
const _ce: _CheckEdgeKinds = true;
void _ck;
void _ce;

export const KIND_META: Record<NodeKind, { label: string; color: string }> = {
  plan: { label: "Plan", color: "#4f9be0" },
  execute: { label: "Execute", color: "#8b7cff" },
  review: { label: "Review", color: "#d8a72b" },
  doc: { label: "Doc", color: "#46b85f" },
  gate: { label: "Gate", color: "#d8803f" },
  context: { label: "Context", color: "#3fc8d6" },
  loop: { label: "Loop", color: "#c77dff" },
};

export const EDGE_META: Record<EdgeKind, { label: string; color: string }> = {
  flow: { label: "Flow", color: "#8b7cff" },
  data: { label: "Data", color: "#3fc8d6" },
  "attaches-to": { label: "Attaches", color: "#9aa1ad" },
  loop: { label: "Loop", color: "#c77dff" },
};
