import { ulid } from "ulid";
import { type IEdgeSpec, type INodeSpec } from "../../db/models/graph.model";
import { getGraphServiceGateway } from "../data/graph-gateway";
import { sprintTasksToGraphSpec } from "../../lib/plan-map";

/** One sprint of an Architect multi-sprint backlog (contract §3b). */
export interface PlanSprintInput {
  number: number;
  name: string;
  tasks?: string[];
}

export interface CreatePlanGraphsInput {
  ownerId: string;
  featureName: string;
  /** The sprint number whose full `tracks` topology is already mapped. */
  currentSprint: number;
  /** The CURRENT sprint's mapped nodes/edges (from `planToGraphSpec`). */
  currentSpec: { nodes: INodeSpec[]; edges: IEdgeSpec[] };
  /** Every sprint in the roadmap (`backlog.sprints[]`). */
  sprints: PlanSprintInput[];
  rootRepoPath?: string;
  baseBranch?: string;
}

export interface CreatePlanGraphsResult {
  planId: string;
  graphs: { graphId: string; sprintNumber: number }[];
}

/**
 * PLAN-4: expand a multi-sprint Architect backlog into ONE linked graph per
 * sprint, so the planner "second brain" spans the whole roadmap instead of a
 * single canvas.
 *
 *  - The CURRENT sprint graph carries the full mapped track topology
 *    (`currentSpec.nodes/edges` from `planToGraphSpec`).
 *  - Every OTHER sprint is seeded from its task-name list via
 *    `sprintTasksToGraphSpec` (a chain of `execute` nodes).
 *  - All graphs share a generated `planId` and carry their `sprintNumber`
 *    (ordered) + `sprintName`.
 *
 * Owner-scoped. Persists via the graph SERVICE gateway (cloud BFF in BFF mode; direct
 * Mongo otherwise) so a multi-sprint plan works with the DB off the laptop. Sprints
 * are created in ascending `number` order; the returned
 * `graphs` preserve that order. Sprints with neither a current topology nor any
 * task names still produce an (empty) graph so the roadmap stays complete.
 */
export async function createPlanGraphs(
  input: CreatePlanGraphsInput,
): Promise<CreatePlanGraphsResult> {
  const planId = ulid();
  const featureName = input.featureName?.trim() || "Plan";

  const ordered = [...(input.sprints ?? [])]
    .filter((s): s is PlanSprintInput => Boolean(s) && typeof s.number === "number")
    .sort((a, b) => a.number - b.number);

  const created: { graphId: string; sprintNumber: number }[] = [];
  const gateway = getGraphServiceGateway();

  for (const sprint of ordered) {
    const isCurrent = sprint.number === input.currentSprint;
    const spec = isCurrent
      ? { nodes: input.currentSpec.nodes ?? [], edges: input.currentSpec.edges ?? [] }
      : sprintTasksToGraphSpec(sprint.tasks ?? []);

    const sprintName = sprint.name?.trim() || `Sprint ${sprint.number}`;

    const graph = await gateway.createFull(input.ownerId, {
      name: `${featureName} — Sprint ${sprint.number}: ${sprintName}`,
      status: "draft",
      rootRepoPath: input.rootRepoPath,
      baseBranch: input.baseBranch ?? "main",
      nodes: spec.nodes,
      edges: spec.edges,
      planId,
      sprintNumber: sprint.number,
      sprintName,
    });

    created.push({
      graphId: String(graph._id),
      sprintNumber: sprint.number,
    });
  }

  return { planId, graphs: created };
}
