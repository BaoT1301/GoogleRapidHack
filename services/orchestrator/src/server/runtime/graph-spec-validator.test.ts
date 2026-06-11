import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArchivedGraphError,
  GraphRevisionConflictError,
  InMemoryGraphRepository
} from "./_ported-types/graph-repository";
import type { GraphSpec } from "./_ported-types/graph-spec";
import { validateGraphSpec } from "./graph-spec-validator";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("GraphSpec validation", () => {
  it("accepts an execute-only DAG in a git repository", async () => {
    const repo = await createTempRepo();
    await expect(validateGraphSpec(createGraph(repo))).resolves.toBeUndefined();
  });

  it("rejects cycles, self-edges, duplicate ids, sanitized id collisions, and invalid base branches", async () => {
    const repo = await createTempRepo();

    await expect(validateGraphSpec(createGraph(repo, {
      edges: [
        { id: "edge_a_b", kind: "flow", source: "node_a", target: "node_b" },
        { id: "edge_b_a", kind: "flow", source: "node_b", target: "node_a" }
      ]
    }))).rejects.toThrow("cycle");

    await expect(validateGraphSpec(createGraph(repo, {
      edges: [{ id: "edge_self", kind: "flow", source: "node_a", target: "node_a" }]
    }))).rejects.toThrow("itself");

    await expect(validateGraphSpec(createGraph(repo, {
      nodes: [executeNode("node_a"), executeNode("node_a")]
    }))).rejects.toThrow("Duplicate node id");

    await expect(validateGraphSpec(createGraph(repo, {
      nodes: [executeNode("node/a"), executeNode("node-a")]
    }))).rejects.toThrow("collide after sanitization");

    await expect(validateGraphSpec(createGraph(repo, {
      baseBranch: "missing-branch"
    }))).rejects.toThrow("git");
  });
});

describe("InMemoryGraphRepository", () => {
  it("increments revisions, rejects stale writes, and rejects edits after archive", () => {
    const repository = new InMemoryGraphRepository();
    const created = repository.createGraph({
      name: "Demo",
      rootRepoPath: "/tmp/demo",
      baseBranch: "main"
    });

    const updated = repository.updateGraph(created.id, {
      expectedRevision: created.revision,
      name: "Demo revision two",
      nodes: undefined,
      edges: undefined
    });
    expect(updated.revision).toBe(2);
    expect(updated.nodes).toEqual([]);
    expect(updated.edges).toEqual([]);
    expect(repository.listGraphs()).toHaveLength(1);
    expect(repository.getGraph(created.id)?.name).toBe("Demo revision two");

    expect(() => repository.updateGraph(created.id, {
      expectedRevision: 1,
      name: "Stale edit"
    })).toThrow(GraphRevisionConflictError);

    const archived = repository.updateGraph(created.id, {
      expectedRevision: 2,
      status: "archived"
    });
    expect(archived.status).toBe("archived");
    expect(() => repository.updateGraph(created.id, {
      expectedRevision: 3,
      name: "Rejected edit"
    })).toThrow(ArchivedGraphError);

    expect(repository.deleteGraph(created.id)).toBe(true);
    expect(repository.getGraph(created.id)).toBeUndefined();
  });
});

async function createTempRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "agent-loom-graph-"));
  tempDirs.push(repo);
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repo });
  await execFileAsync("git", ["config", "user.email", "agent-loom@example.test"], { cwd: repo });
  await execFileAsync("git", ["config", "user.name", "Agent Loom Test"], { cwd: repo });
  await writeFile(path.join(repo, "README.md"), "# temp repo\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: repo });
  await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: repo });
  return repo;
}

function createGraph(repo: string, overrides: Partial<GraphSpec> = {}): GraphSpec {
  return {
    graphSpecVersion: "1.0",
    id: "graph_demo",
    name: "Demo graph",
    rootRepoPath: repo,
    baseBranch: "main",
    status: "draft",
    revision: 1,
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    nodes: [executeNode("node_a"), executeNode("node_b")],
    edges: [{ id: "edge_a_b", kind: "flow", source: "node_a", target: "node_b" }],
    ...overrides
  };
}

function executeNode(id: string): GraphSpec["nodes"][number] {
  return {
    id,
    kind: "execute",
    label: id,
    cli: "fake",
    prompt: `Run ${id}`,
    position: { x: 0, y: 0 }
  };
}
