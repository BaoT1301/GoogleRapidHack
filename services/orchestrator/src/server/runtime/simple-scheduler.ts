export interface SimpleSchedulerNode {
  id: string;
}

export interface SimpleSchedulerEdge {
  source: string;
  target: string;
  kind?: string;
}

/**
 * Flow edges only (`kind === "flow"` or undefined) with both endpoints present.
 * Single source of truth for "what gates ordering" — reused by the scheduler
 * and the merge-back coordinator (GIT-1) so they never disagree.
 */
export function flowEdges<TNode extends SimpleSchedulerNode>(
  nodes: TNode[],
  edges: SimpleSchedulerEdge[],
): SimpleSchedulerEdge[] {
  const ids = new Set(nodes.map((node) => node.id));
  return edges.filter(
    (edge) =>
      (edge.kind === undefined || edge.kind === "flow") &&
      ids.has(edge.source) &&
      ids.has(edge.target),
  );
}

/**
 * Kahn topological order over flow edges, stable w.r.t. the input node order.
 * Any nodes left over by a cycle (flow cycles are rejected upstream by
 * `graph-validation`) are appended in input order so the result is total.
 */
export function topologicalOrder<TNode extends SimpleSchedulerNode>(
  nodes: TNode[],
  edges: SimpleSchedulerEdge[],
): TNode[] {
  const flow = flowEdges(nodes, edges);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of flow) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const queue = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const ordered: TNode[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodesById.get(id);
    if (node) ordered.push(node);
    for (const next of outgoing.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) <= 0 && !seen.has(next)) {
        queue.push(next);
      }
    }
  }

  for (const node of nodes) {
    if (!seen.has(node.id)) ordered.push(node);
  }

  return ordered;
}

/** Transitive flow-descendants of `nodeId` (used for conflict short-circuit). */
export function flowDescendants(
  nodeId: string,
  nodes: SimpleSchedulerNode[],
  edges: SimpleSchedulerEdge[],
): Set<string> {
  const flow = flowEdges(nodes, edges);
  const outgoing = new Map<string, string[]>();
  for (const edge of flow) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }
  const descendants = new Set<string>();
  const stack = [...(outgoing.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (descendants.has(next)) continue;
    descendants.add(next);
    stack.push(...(outgoing.get(next) ?? []));
  }
  return descendants;
}

export interface SimpleSchedulerResult<TNode extends SimpleSchedulerNode, TResult> {
  node: TNode;
  status: "success" | "failed" | "skipped";
  result?: TResult;
}

export async function runSimpleScheduler<TNode extends SimpleSchedulerNode, TResult>(input: {
  nodes: TNode[];
  edges: SimpleSchedulerEdge[];
  runNode: (node: TNode) => Promise<TResult>;
  isSuccessfulResult: (result: TResult) => boolean;
  onNodeSkipped?: (node: TNode, reason: string) => void;
  maxConcurrency?: number;
  /**
   * RUN-3: optional per-node fan-in mode. Defaults to `all-of` for every node,
   * which is the historical behaviour (a node runs only when ALL flow
   * predecessors succeeded). `any-of` nodes (gates) become ready once all
   * predecessors are terminal with at least one success, and are only skipped
   * when all predecessors are terminal with zero successes. `execute` nodes use
   * the default, so existing runs are unaffected.
   */
  getFanInMode?: (node: TNode) => "all-of" | "any-of";
}): Promise<Array<SimpleSchedulerResult<TNode, TResult>>> {
  const maxConcurrency = input.maxConcurrency ?? 4;
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const fanInModeOf = (nodeId: string): "all-of" | "any-of" => {
    const node = nodesById.get(nodeId);
    return node && input.getFanInMode ? input.getFanInMode(node) : "all-of";
  };
  const flowEdges = input.edges.filter(
    (edge) =>
      (edge.kind === undefined || edge.kind === "flow") &&
      nodesById.has(edge.source) &&
      nodesById.has(edge.target)
  );
  const incomingByNodeId = new Map<string, Set<string>>();
  const outgoingByNodeId = new Map<string, Set<string>>();

  for (const node of input.nodes) {
    incomingByNodeId.set(node.id, new Set());
    outgoingByNodeId.set(node.id, new Set());
  }

  for (const edge of flowEdges) {
    incomingByNodeId.get(edge.target)?.add(edge.source);
    outgoingByNodeId.get(edge.source)?.add(edge.target);
  }

  const pending = new Set(input.nodes.map((node) => node.id));
  const running = new Set<string>();
  const succeeded = new Set<string>();
  const terminal = new Set<string>();
  const results: Array<SimpleSchedulerResult<TNode, TResult>> = [];

  return await new Promise((resolve) => {
    const pump = () => {
      for (const nodeId of Array.from(pending)) {
        if (fanInModeOf(nodeId) === "any-of") {
          // any-of: only skip when ALL predecessors are terminal and none
          // succeeded; a single failed/skipped predecessor is tolerated.
          const predecessors = incomingByNodeId.get(nodeId) ?? new Set<string>();
          if (predecessors.size > 0) {
            let allTerminal = true;
            let anySucceeded = false;
            for (const predecessorId of predecessors) {
              if (!terminal.has(predecessorId)) allTerminal = false;
              if (succeeded.has(predecessorId)) anySucceeded = true;
            }
            if (allTerminal && !anySucceeded) {
              skipNodeAndDescendants(
                nodeId,
                `All upstreams of ${nodeId} failed or were skipped (any-of)`,
              );
            }
          }
          continue;
        }

        const failedPredecessor = firstFailedOrSkippedPredecessor(
          nodeId,
          incomingByNodeId,
          terminal,
          succeeded
        );

        if (failedPredecessor) {
          skipNodeAndDescendants(nodeId, `Dependency ${failedPredecessor} did not complete successfully`);
        }
      }

      for (const nodeId of Array.from(pending)) {
        if (running.size >= maxConcurrency) {
          break;
        }

        if (!isReady(nodeId, incomingByNodeId, succeeded, terminal, fanInModeOf(nodeId))) {
          continue;
        }

        const node = nodesById.get(nodeId);
        if (!node) {
          continue;
        }

        pending.delete(nodeId);
        running.add(nodeId);

        void input.runNode(node)
          .then((result) => {
            const successful = input.isSuccessfulResult(result);
            results.push({
              node,
              result,
              status: successful ? "success" : "failed"
            });

            if (successful) {
              succeeded.add(nodeId);
            }
          })
          .catch(() => {
            results.push({
              node,
              status: "failed"
            });
          })
          .finally(() => {
            running.delete(nodeId);
            terminal.add(nodeId);
            pump();
          });
      }

      if (pending.size === 0 && running.size === 0) {
        resolve(results);
      }
    };

    const skipNodeAndDescendants = (nodeId: string, reason: string) => {
      if (!pending.has(nodeId)) {
        return;
      }

      const node = nodesById.get(nodeId);
      pending.delete(nodeId);
      terminal.add(nodeId);

      if (node) {
        input.onNodeSkipped?.(node, reason);
        results.push({
          node,
          status: "skipped"
        });
      }

      for (const childId of outgoingByNodeId.get(nodeId) ?? []) {
        skipNodeAndDescendants(childId, `Dependency ${nodeId} was skipped`);
      }
    };

    pump();
  });
}

function isReady(
  nodeId: string,
  incomingByNodeId: Map<string, Set<string>>,
  succeeded: Set<string>,
  terminal: Set<string>,
  fanInMode: "all-of" | "any-of"
): boolean {
  const predecessors = incomingByNodeId.get(nodeId) ?? new Set<string>();

  if (fanInMode === "any-of") {
    // Ready once every predecessor has settled (terminal) AND at least one
    // succeeded; a gate never runs before its predecessors settle.
    if (predecessors.size === 0) {
      return true;
    }
    let allTerminal = true;
    let anySucceeded = false;
    for (const predecessorId of predecessors) {
      if (!terminal.has(predecessorId)) allTerminal = false;
      if (succeeded.has(predecessorId)) anySucceeded = true;
    }
    return allTerminal && anySucceeded;
  }

  for (const predecessorId of predecessors) {
    if (!succeeded.has(predecessorId)) {
      return false;
    }
  }

  return true;
}

function firstFailedOrSkippedPredecessor(
  nodeId: string,
  incomingByNodeId: Map<string, Set<string>>,
  terminal: Set<string>,
  succeeded: Set<string>
): string | undefined {
  for (const predecessorId of incomingByNodeId.get(nodeId) ?? []) {
    if (terminal.has(predecessorId) && !succeeded.has(predecessorId)) {
      return predecessorId;
    }
  }

  return undefined;
}
