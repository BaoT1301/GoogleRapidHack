import { describe, it, expect } from "vitest";
import { evaluateKbHealth, type KbHealthInput } from "./kb-validate";

const healthy: KbHealthInput = {
  source: "mcp-context-manager",
  symbolCount: 480,
  fileCount: 120,
  vectorCount: 480,
  embeddingsEnabled: true,
  isGitRepo: true,
  stale: false,
  synced: true,
};

describe("evaluateKbHealth", () => {
  it("a fully-indexed git repo is ok with no warnings", () => {
    const r = evaluateKbHealth(healthy);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("never-synced is not ok and short-circuits to one clear message", () => {
    const r = evaluateKbHealth({ ...healthy, synced: false });
    expect(r.ok).toBe(false);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/not been synced/i);
  });

  it("zero symbols is blocking", () => {
    const r = evaluateKbHealth({ ...healthy, symbolCount: 0, vectorCount: 0 });
    expect(r.ok).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/No symbols indexed/i);
  });

  it("embeddings enabled but no vectors is blocking (keyword-only)", () => {
    const r = evaluateKbHealth({ ...healthy, vectorCount: 0 });
    expect(r.ok).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/keyword-only/i);
  });

  it("repo-scan + stale + non-git are advisory (ok stays true)", () => {
    const r = evaluateKbHealth({
      ...healthy,
      source: "repo-scan",
      isGitRepo: false,
      stale: true,
    });
    expect(r.ok).toBe(true);
    const text = r.warnings.join(" ");
    expect(text).toMatch(/MCP_CONTEXT_URL/);
    expect(text).toMatch(/git repository/i);
    expect(text).toMatch(/out of date/i);
  });
});
