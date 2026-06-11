import type { McpServerRef } from "./mcp-config-builder";

/**
 * MCP-2 — Per-node MCP config via an attached Context node.
 *
 * A `context` node attached to an `execute` node via an `attaches-to` edge can
 * carry MCP server spec(s) in its `data`. This pure resolver finds those context
 * nodes and normalizes their specs into `McpServerRef[]` `overrides`, which the
 * execute path passes to `materializeMcpConfig` → `buildMCPConfig` (step 6,
 * last-write-wins). NO new node/edge kind — `context` + `attaches-to` already exist.
 *
 * Accepted `data` shapes on a context node (flexible, validated/normalized):
 *   - single server:   `{ name?, command, args?, env? }`
 *   - keyed map:        `{ mcpServers: { "<name>": { command, args?, env? } } }`
 *   - explicit list:    `{ servers: [{ name, command, args?, env? }] }`
 *
 * Invalid/secretless-but-malformed entries are dropped (never throws). The merge
 * order (later overrides win) follows edge/array order so behavior is predictable.
 */

const ATTACHES_TO = "attaches-to";
const CONTEXT_KIND = "context";

interface MinNode {
  id: string;
  kind?: string;
  label?: string;
  data?: unknown;
}
interface MinEdge {
  source: string;
  target: string;
  kind?: string;
}

/** Normalize an arbitrary `args` value into a `string[]` (drops non-strings). */
function normalizeArgs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is string => typeof a === "string");
}

/** Normalize an arbitrary `env` value into a `Record<string,string>` or undefined. */
function normalizeEnv(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Build one validated McpServerRef, or null when name/command are missing. */
function toServerRef(
  name: unknown,
  command: unknown,
  args: unknown,
  env: unknown,
): McpServerRef | null {
  const n = typeof name === "string" ? name.trim() : "";
  const c = typeof command === "string" ? command.trim() : "";
  if (!n || !c) return null;
  const ref: McpServerRef = { name: n, command: c, args: normalizeArgs(args) };
  const e = normalizeEnv(env);
  if (e) ref.env = e;
  return ref;
}

/** Extract every server spec carried by a single context node's `data`. */
export function normalizeContextServers(data: unknown, fallbackName: string): McpServerRef[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const refs: McpServerRef[] = [];

  // Shape A — keyed map `{ mcpServers: { name: { command, args, env } } }`.
  if (d.mcpServers && typeof d.mcpServers === "object" && !Array.isArray(d.mcpServers)) {
    for (const [name, spec] of Object.entries(d.mcpServers as Record<string, unknown>)) {
      if (spec && typeof spec === "object") {
        const s = spec as Record<string, unknown>;
        const ref = toServerRef(s.name ?? name, s.command, s.args, s.env);
        if (ref) refs.push(ref);
      }
    }
  }

  // Shape B — explicit list `{ servers: [{ name, command, args, env }] }`.
  if (Array.isArray(d.servers)) {
    d.servers.forEach((spec, i) => {
      if (spec && typeof spec === "object") {
        const s = spec as Record<string, unknown>;
        const ref = toServerRef(s.name ?? `${fallbackName}-${i + 1}`, s.command, s.args, s.env);
        if (ref) refs.push(ref);
      }
    });
  }

  // Shape C — a single inline server `{ name?, command, args?, env? }`.
  if (typeof d.command === "string") {
    const ref = toServerRef(d.name ?? fallbackName, d.command, d.args, d.env);
    if (ref) refs.push(ref);
  }

  return refs;
}

/**
 * Resolve the MCP `overrides` contributed by `context` nodes attached to the
 * given `execute` node via an `attaches-to` edge (either direction — the OTHER
 * endpoint is the context node). Returns a flat, de-duplicated-by-name (last
 * wins) `McpServerRef[]`.
 */
export function resolveContextMcpOverrides(
  executeNodeId: string,
  nodes: MinNode[],
  edges: MinEdge[],
): McpServerRef[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Collect the IDs of nodes attached to this execute node via attaches-to.
  const attachedIds: string[] = [];
  for (const e of edges) {
    if (e.kind !== ATTACHES_TO) continue;
    if (e.target === executeNodeId) attachedIds.push(e.source);
    else if (e.source === executeNodeId) attachedIds.push(e.target);
  }

  const byName = new Map<string, McpServerRef>();
  for (const id of attachedIds) {
    const node = nodeById.get(id);
    if (!node || node.kind !== CONTEXT_KIND) continue;
    const fallbackName = (node.label || node.id || "context").toString();
    for (const ref of normalizeContextServers(node.data, fallbackName)) {
      byName.set(ref.name, ref); // last-write-wins on duplicate names
    }
  }

  return [...byName.values()];
}
