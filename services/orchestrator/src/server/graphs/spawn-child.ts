import { ulid } from "ulid";
import { type IEdgeSpec, type INodeSpec } from "../../db/models/graph.model";
import { getGraphServiceGateway } from "../data/graph-gateway";
import { getSettingsGateway } from "../data/settings-gateway";

/**
 * WOW-3 captured grounding seeded onto the spawned fixer node's `data.context`.
 * `fromNodes` are the parent node ids the context was captured from.
 */
export interface FixerContextSeed {
  fromNodes: string[];
  diffPreview?: string;
  lastError?: string;
}

export interface CreateChildGraphInput {
  ownerId: string;
  parentGraphId: string;
  parentNodeId: string;
  name: string;
  nodes?: INodeSpec[];
  edges?: IEdgeSpec[];
  /**
   * WOW-3: optional captured fixer context. When present it is seeded onto the
   * fixer node's `data.context` (additively — caller-supplied `data` fields are
   * never clobbered). Omitting it is fully back-compatible.
   */
  context?: FixerContextSeed;
  /** Optional request ctx (live token) so BFF mode reads fixer defaults from the cloud. */
  ctx?: { token?: string | null };
}

/**
 * MODEL-1: read the owner's persisted fixer defaults (cli/model/persona) for
 * seeding a default Fixer node. Never throws — a settings lookup must not break a
 * spawn. `ctx` (with a live token) selects the BFF backend in BFF mode.
 */
async function resolveFixerConfig(
  ownerId: string,
  ctx?: { token?: string | null },
): Promise<{ cli?: string; model?: string; persona?: string }> {
  try {
    const settings = await getSettingsGateway(ctx ?? {}).get(ownerId);
    return settings.fixerConfig ?? {};
  } catch {
    return {};
  }
}

/**
 * Create an owner-scoped child sub-graph linked to a parent node
 * (`parentGraphId`/`parentNodeId`), inheriting the parent's repo context. The
 * parent is never mutated. Returns `null` when the parent is not owned by the
 * caller (callers map that to a 404). Shared by `graphs.spawnChild` (the tRPC
 * mutation) and the runtime's auto-spawned conflict reviewer (GIT-3) so the
 * spawn shape lives in exactly one place (Do-Not-Invent).
 */
export async function createChildGraph(input: CreateChildGraphInput) {
  // Service gateway: works from the background runtime (conflict reviewer) which has
  // no user token — cloud BFF in BFF mode, direct Mongo otherwise.
  const gateway = getGraphServiceGateway();
  const parent = await gateway.getById(input.ownerId, input.parentGraphId);
  if (!parent) return null;

  // Seed a single Execute "fixer" node when the caller supplies none. The owner's
  // persisted fixer defaults (cli/model/persona) pre-configure that default node.
  const callerSuppliedNodes = Boolean(input.nodes && input.nodes.length > 0);
  let seededNodes: INodeSpec[];
  if (callerSuppliedNodes) {
    seededNodes = input.nodes as INodeSpec[];
  } else {
    const fixer = await resolveFixerConfig(input.ownerId, input.ctx);
    seededNodes = [
      {
        id: ulid(),
        kind: "execute",
        label: "Fixer",
        position: { x: 0, y: 0 },
        status: "pending",
        data: {
          ...(fixer.cli ? { cli: fixer.cli } : {}),
          ...(fixer.model ? { model: fixer.model } : {}),
          ...(fixer.persona ? { persona: fixer.persona } : {}),
        },
      },
    ];
  }

  // WOW-3: seed captured grounding onto the fixer node's `data.context`. Spread
  // `context` first so any caller-supplied `data` fields win (no clobbering) —
  // mirrors how the GIT-3 conflict reviewer seeds `data.conflict`/`data.prompt`.
  if (input.context && seededNodes.length > 0) {
    const head = seededNodes[0];
    seededNodes[0] = {
      ...head,
      data: { context: input.context, ...(head.data ?? {}) },
    };
  }

  const child = await gateway.createFull(input.ownerId, {
    name: input.name,
    status: "draft",
    parentGraphId: input.parentGraphId,
    parentNodeId: input.parentNodeId,
    rootRepoPath: parent.rootRepoPath as string | undefined,
    baseBranch: parent.baseBranch as string | undefined,
    nodes: seededNodes,
    edges: input.edges ?? [],
  });
  return child;
}
