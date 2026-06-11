import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeMcpConfig } from "./mcp-config-materializer";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("materializeMcpConfig", () => {
  it("writes serialized MCP config under repo .orchestrator tmp with private permissions", async () => {
    const rootRepoPath = await mkdtemp(path.join(os.tmpdir(), "agent-loom-mcp-config-"));
    tempRoots.push(rootRepoPath);

    const result = await materializeMcpConfig({
      rootRepoPath,
      runId: "run/unsafe id",
      nodeId: "node unsafe/id",
      worktreePath: path.join(rootRepoPath, ".orchestrator", "worktrees", "run", "node"),
      overrides: [
        {
          name: "custom",
          command: "node",
          args: ["server.js"],
          env: { CUSTOM_TOKEN: "secret-value" },
        },
      ],
    });

    expect(result.mcpConfigPath).toBe(
      path.join(rootRepoPath, ".orchestrator", "tmp", "run_unsafe_id", "node_unsafe_id", "mcp-config.json"),
    );
    expect(result.notes.join(" ")).toContain("Codex currently keeps using");

    const written = await readFile(result.mcpConfigPath, "utf8");
    const parsed = JSON.parse(written) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers.custom).toBeDefined();

    if (process.platform !== "win32") {
      const mode = (await stat(result.mcpConfigPath)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});
