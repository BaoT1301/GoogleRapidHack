import type { IEdgeSpec, INodeSpec } from "@/db/models/graph.model";

export type DemoGraphId =
  | "four_fake_parallel"
  | "fake_dependency_chain"
  | "one_codex_smoke"
  | "multi_cli_codex_gemini"
  | "plan_proposal_demo"
  | "gate_fan_in_demo"
  | "loop_child_graph_demo"
  | "mixed_plan_gate_loop_demo";

export interface RuntimeDemoGraph {
  id: DemoGraphId;
  name: string;
  description: string;
  baseBranch: string;
  nodes: INodeSpec[];
  edges: IEdgeSpec[];
}

export const RUNTIME_DEMO_GRAPHS: RuntimeDemoGraph[] = [
  {
    id: "four_fake_parallel",
    name: "Four Fake Agents Parallel",
    description: "Four independent deterministic fake execute nodes for terminal/SSE/worktree testing.",
    baseBranch: "stephen-develop",
    nodes: [
      executeNode("node_frontend", "Frontend Fake Agent", "fake", "Fake frontend task", 0, 0),
      executeNode("node_backend", "Backend Fake Agent", "fake", "Fake backend task", 360, 0),
      executeNode("node_tests", "Tests Fake Agent", "fake", "Fake tests task", 0, 220),
      executeNode("node_docs", "Docs Fake Agent", "fake", "Fake docs task", 360, 220),
    ],
    edges: [],
  },
  {
    id: "fake_dependency_chain",
    name: "Fake Dependency Chain",
    description: "A -> B -> C fake execute graph for scheduler and dependency UI testing.",
    baseBranch: "stephen-develop",
    nodes: [
      executeNode("node_a", "Fake Step A", "fake", "Fake dependency step A", 0, 0),
      executeNode("node_b", "Fake Step B", "fake", "Fake dependency step B after A", 340, 0),
      executeNode("node_c", "Fake Step C", "fake", "Fake dependency step C after B", 680, 0),
    ],
    edges: [
      flowEdge("edge_a_b", "node_a", "node_b"),
      flowEdge("edge_b_c", "node_b", "node_c"),
    ],
  },
  {
    id: "one_codex_smoke",
    name: "One Codex Smoke",
    description: "Single Codex execute node that creates CODEX_RUNTIME_TEST.md in an isolated worktree.",
    baseBranch: "stephen-develop",
    nodes: [
      executeNode(
        "node_codex_smoke",
        "Codex Smoke Agent",
        "codex",
        [
          "Create CODEX_RUNTIME_TEST.md in the current isolated worktree.",
          "Add a short note confirming this Codex runtime smoke test.",
          "Do not edit other files.",
          "At the end, print a valid <!-- orch:output --> JSON block with summary, filesChanged, and status fields.",
        ].join(" "),
        0,
        0,
      ),
    ],
    edges: [],
  },
  {
    id: "multi_cli_codex_gemini",
    name: "Multi-CLI Codex + Gemini",
    description: "Phase 7.3 demo graph: Codex and Gemini run in parallel in separate worktrees, with a deterministic fake fallback lane.",
    baseBranch: "stephen-develop",
    nodes: [
      executeNode(
        "node_codex",
        "Codex Agent",
        "codex",
        [
          "Create CODEX_MULTI_CLI_RUNTIME_TEST.md in the current isolated worktree.",
          "Add one sentence confirming the Codex lane of the multi-CLI runtime demo.",
          "Do not edit other files.",
          "At the end, print a valid <!-- orch:output --> JSON block with summary, filesChanged, and status fields.",
        ].join(" "),
        0,
        0,
      ),
      executeNode(
        "node_gemini",
        "Gemini Agent",
        "gemini",
        [
          "Create GEMINI_MULTI_CLI_RUNTIME_TEST.md in the current isolated worktree.",
          "Add one sentence confirming the Gemini lane of the multi-CLI runtime demo.",
          "Do not edit other files.",
          "At the end, print a valid <!-- orch:output --> JSON block with summary, filesChanged, and status fields.",
        ].join(" "),
        360,
        0,
      ),
      executeNode(
        "node_fake_fallback",
        "Fake Fallback",
        "fake",
        "Run the deterministic fake fallback lane for the multi-CLI demo.",
        720,
        0,
      ),
    ],
    edges: [],
  },
  {
    id: "plan_proposal_demo",
    name: "Plan Proposal Demo",
    description: "Plan node generates a proposal/context result, blocks downstream by default, and can be explicitly applied to the graph for the next run.",
    baseBranch: "stephen-develop",
    nodes: [
      planNode(
        "node_plan_proposal",
        "Plan Proposal",
        "Improve this workflow by adding a test and review lane.",
        "Generate a GraphSpec proposal for a safer workflow. Do not mutate the graph during the run.",
        0,
        0,
      ),
      executeNode("node_after_plan", "Downstream Fake Agent", "fake", "This node should stay skipped until the Plan proposal is explicitly approved for a future run.", 420, 0),
    ],
    edges: [
      flowEdge("edge_plan_after", "node_plan_proposal", "node_after_plan"),
    ],
  },
  {
    id: "gate_fan_in_demo",
    name: "Gate Fan-In Demo",
    description: "Two fake execute nodes feed both all-of and any-of gates, then downstream fake nodes show pass/block behavior.",
    baseBranch: "stephen-develop",
    nodes: [
      executeNode("node_gate_a", "Fake Upstream A", "fake", "Gate demo upstream A.", 0, 0),
      executeNode("node_gate_b", "Fake Upstream B", "fake", "Gate demo upstream B. Set FAKE_AGENT_FAIL_NODES=node_gate_b to demonstrate blocked all-of.", 0, 220),
      gateNode("gate_all_of", "All-of Gate", 360, 40),
      gateNode("gate_any_of", "Any-of Gate", 360, 260),
      executeNode("node_after_all_of", "After All-of", "fake", "Runs only when both upstream fake nodes succeed.", 720, 40),
      executeNode("node_after_any_of", "After Any-of", "fake", "Runs when at least one upstream fake node succeeds.", 720, 260),
    ],
    edges: [
      flowEdge("edge_gate_a_all", "node_gate_a", "gate_all_of"),
      flowEdge("edge_gate_b_all", "node_gate_b", "gate_all_of"),
      flowEdge("edge_gate_all_after", "gate_all_of", "node_after_all_of"),
      flowEdge("edge_gate_a_any", "node_gate_a", "gate_any_of", "any-of"),
      flowEdge("edge_gate_b_any", "node_gate_b", "gate_any_of", "any-of"),
      flowEdge("edge_gate_any_after", "gate_any_of", "node_after_any_of"),
    ],
  },
  {
    id: "loop_child_graph_demo",
    name: "Loop Child Graph Demo",
    description: "Loop node linked to a seeded child fake graph. Shows loop started/iteration/break/exhausted events and the maxIterations cap.",
    baseBranch: "stephen-develop",
    nodes: [
      loopNode("node_loop_child", "Loop Child Fake Graph", 0, 0),
      executeNode("node_after_loop", "After Loop", "fake", "Runs after the loop child graph succeeds.", 420, 0),
    ],
    edges: [
      flowEdge("edge_loop_after", "node_loop_child", "node_after_loop"),
    ],
  },
  {
    id: "mixed_plan_gate_loop_demo",
    name: "Mixed Plan Gate Loop Execute Demo",
    description: "Optional mixed control-node graph: Plan proposal blocks by default before Gate/Loop/Execute can proceed.",
    baseBranch: "stephen-develop",
    nodes: [
      planNode("node_mixed_plan", "Plan Proposal", "Plan a safer implementation path.", "Generate a proposal only; do not mutate the graph.", 0, 0),
      executeNode("node_mixed_a", "Fake A", "fake", "Mixed graph fake upstream A.", 360, 0),
      executeNode("node_mixed_b", "Fake B", "fake", "Mixed graph fake upstream B.", 360, 220),
      gateNode("node_mixed_gate", "Quality Gate", 720, 100),
      loopNode("node_mixed_loop", "Loop Child", 1080, 100),
      executeNode("node_mixed_finish", "Final Fake Agent", "fake", "Final fake lane after Plan, Gate, and Loop control nodes.", 1440, 100),
    ],
    edges: [
      flowEdge("edge_mixed_plan_a", "node_mixed_plan", "node_mixed_a"),
      flowEdge("edge_mixed_plan_b", "node_mixed_plan", "node_mixed_b"),
      flowEdge("edge_mixed_a_gate", "node_mixed_a", "node_mixed_gate"),
      flowEdge("edge_mixed_b_gate", "node_mixed_b", "node_mixed_gate"),
      flowEdge("edge_mixed_gate_loop", "node_mixed_gate", "node_mixed_loop"),
      flowEdge("edge_mixed_loop_finish", "node_mixed_loop", "node_mixed_finish"),
    ],
  },
];

export function getRuntimeDemoGraph(id: DemoGraphId): RuntimeDemoGraph | undefined {
  return RUNTIME_DEMO_GRAPHS.find((graph) => graph.id === id);
}

export function getLoopChildFakeDemoGraph(): RuntimeDemoGraph {
  return {
    id: "loop_child_graph_demo",
    name: "Loop Child Fake Graph",
    description: "Child graph seeded for the Loop Child Graph Demo.",
    baseBranch: "stephen-develop",
    nodes: [
      executeNode("node_loop_child_fake", "Loop Child Fake Agent", "fake", "Deterministic fake child graph iteration.", 0, 0),
    ],
    edges: [],
  };
}

function executeNode(
  id: string,
  label: string,
  cli: "fake" | "codex" | "gemini",
  prompt: string,
  x: number,
  y: number,
): INodeSpec {
  return {
    id,
    kind: "execute",
    label,
    position: { x, y },
    status: "pending",
    data: { cli, prompt },
  };
}

function planNode(
  id: string,
  label: string,
  objective: string,
  prompt: string,
  x: number,
  y: number,
): INodeSpec {
  return {
    id,
    kind: "plan",
    label,
    position: { x, y },
    status: "pending",
    data: {
      objective,
      prompt,
      allowDownstreamAfterProposal: false,
    },
  };
}

function gateNode(id: string, label: string, x: number, y: number): INodeSpec {
  return {
    id,
    kind: "gate",
    label,
    position: { x, y },
    status: "pending",
    data: {},
  };
}

function loopNode(id: string, label: string, x: number, y: number): INodeSpec {
  return {
    id,
    kind: "loop",
    label,
    position: { x, y },
    status: "pending",
    data: {
      maxIterations: 3,
      breakCondition: "Planning hint only: stop when the child graph succeeds.",
    },
  };
}

function flowEdge(id: string, source: string, target: string, fanInMode?: "all-of" | "any-of"): IEdgeSpec {
  return { id, source, target, kind: "flow", ...(fanInMode ? { fanInMode } : {}) };
}
