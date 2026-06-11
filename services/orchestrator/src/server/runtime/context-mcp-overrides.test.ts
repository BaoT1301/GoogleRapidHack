import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeContextServers,
  resolveContextMcpOverrides,
} from "./context-mcp-overrides";
import { materializeMcpConfig } from "./runtime-mcp-config";

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmpWorktree(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-"));
  tmpDirs.push(dir);
  return dir;
}

/** MCP-2: a `context` node attached via `attaches-to` injects per-node MCP servers. */
describe("normalizeContextServers", () => {
  it("reads a single inline server { name, command, args, env }", () => {
    const refs = normalizeContextServers(
      { name: "tavily", command: "npx", args: ["-y", "tavily-mcp"], env: { TAVILY_KEY: "x" } },
      "ctx",
    );
    expect(refs).toEqual([
      { name: "tavily", command: "npx", args: ["-y", "tavily-mcp"], env: { TAVILY_KEY: "x" } },
    ]);
  });

  it("reads a keyed mcpServers map", () => {
    const refs = normalizeContextServers(
      { mcpServers: { docs: { command: "node", args: ["docs.js"] } } },
      "ctx",
    );
    expect(refs).toEqual([{ name: "docs", command: "node", args: ["docs.js"] }]);
  });

  it("reads an explicit servers[] list and falls back to the node name", () => {
    const refs = normalizeContextServers(
      { servers: [{ command: "a" }, { name: "b", command: "bb" }] },
      "ctx",
    );
    expect(refs).toEqual([
      { name: "ctx-1", command: "a", args: [] },
      { name: "b", command: "bb", args: [] },
    ]);
  });

  it("drops malformed specs (missing command/name) and non-string args/env", () => {
    expect(normalizeContextServers({ name: "x" }, "ctx")).toEqual([]); // no command
    expect(normalizeContextServers({ command: "" }, "ctx")).toEqual([]); // empty command
    const refs = normalizeContextServers(
      { name: "ok", command: "run", args: ["good", 5, null], env: { A: "1", B: 2 } },
      "ctx",
    );
    expect(refs).toEqual([{ name: "ok", command: "run", args: ["good"], env: { A: "1" } }]);
  });

  it("is empty for non-objects", () => {
    expect(normalizeContextServers(undefined, "ctx")).toEqual([]);
    expect(normalizeContextServers("nope", "ctx")).toEqual([]);
  });
});

describe("resolveContextMcpOverrides", () => {
  const exec = { id: "exec1", kind: "execute" };
  const ctx = {
    id: "ctx1",
    kind: "context",
    label: "Research MCP",
    data: { name: "tavily", command: "npx", args: ["-y", "tavily-mcp"] },
  };

  it("resolves a context node attached to the execute node (context→execute)", () => {
    const refs = resolveContextMcpOverrides("exec1", [exec, ctx], [
      { source: "ctx1", target: "exec1", kind: "attaches-to" },
    ]);
    expect(refs).toEqual([{ name: "tavily", command: "npx", args: ["-y", "tavily-mcp"] }]);
  });

  it("resolves regardless of edge direction (execute→context)", () => {
    const refs = resolveContextMcpOverrides("exec1", [exec, ctx], [
      { source: "exec1", target: "ctx1", kind: "attaches-to" },
    ]);
    expect(refs).toHaveLength(1);
  });

  it("ignores non-attaches-to edges and non-context nodes", () => {
    const other = { id: "n2", kind: "execute", data: { command: "x" } };
    const refs = resolveContextMcpOverrides("exec1", [exec, ctx, other], [
      { source: "ctx1", target: "exec1", kind: "flow" }, // wrong edge kind
      { source: "n2", target: "exec1", kind: "attaches-to" }, // not a context node
    ]);
    expect(refs).toEqual([]);
  });

  it("de-duplicates by server name (last attached wins)", () => {
    const ctxA = { id: "a", kind: "context", data: { name: "dup", command: "first" } };
    const ctxB = { id: "b", kind: "context", data: { name: "dup", command: "second" } };
    const refs = resolveContextMcpOverrides("exec1", [exec, ctxA, ctxB], [
      { source: "a", target: "exec1", kind: "attaches-to" },
      { source: "b", target: "exec1", kind: "attaches-to" },
    ]);
    expect(refs).toEqual([{ name: "dup", command: "second", args: [] }]);
  });
});

describe("end-to-end: attached context server lands in the materialized mcp.json", () => {
  it("merges the override server alongside the default servers", async () => {
    const worktreePath = await tmpWorktree();
    const overrides = resolveContextMcpOverrides(
      "exec1",
      [
        { id: "exec1", kind: "execute" },
        {
          id: "ctx1",
          kind: "context",
          label: "ctx",
          data: { name: "tavily", command: "npx", args: ["-y", "tavily-mcp"] },
        },
      ],
      [{ source: "ctx1", target: "exec1", kind: "attaches-to" }],
    );

    const result = await materializeMcpConfig({
      runId: "run1",
      nodeId: "exec1",
      worktreePath,
      cli: "kiro",
      overrides,
    });

    expect(result.servers).toContain("tavily");
    expect(result.servers).toContain("mcp-context-manager"); // defaults preserved
    const written = JSON.parse(await readFile(result.mcpConfigPath, "utf8"));
    expect(written.mcpServers.tavily).toEqual({ command: "npx", args: ["-y", "tavily-mcp"] });
  });
});
