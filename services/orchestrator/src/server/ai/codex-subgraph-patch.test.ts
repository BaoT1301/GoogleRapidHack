import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { generateCodexSubgraphPatch } from "./codex-subgraph-patch";

describe("generateCodexSubgraphPatch", () => {
  it("runs Codex CLI read-only with the selected GPT model and validates SubgraphPatch output", async () => {
    const execFileImpl = vi.fn(async (_command, args) => {
      const outputIndex = args.indexOf("--output-last-message");
      const outputPath = args[outputIndex + 1];
      await writeFile(
        outputPath,
        JSON.stringify({
          graphId: "g1",
          selectedNodeIds: ["a"],
          summary: "Improve selected node prompt.",
          rationale: "Codex proposed a more specific prompt.",
          operations: [
            {
              type: "updateNode",
              nodeId: "a",
              patch: {
                data: {
                  prompt: "Create a.txt and verify the file contents.",
                },
              },
            },
          ],
          warnings: [],
        }),
        "utf8",
      );
      return { stdout: "", stderr: "" };
    });

    const patch = await generateCodexSubgraphPatch({
      graphId: "g1",
      selectedNodeIds: ["a"],
      prompt: "Make this more robust",
      mode: "improve",
      model: "gpt-4.1",
      cwd: "/tmp/repo",
      execFileImpl,
      nodes: [
        {
          id: "a",
          kind: "execute",
          label: "Execute",
          position: { x: 0, y: 0 },
          status: "pending",
          data: { prompt: "create a.txt" },
        },
      ],
      edges: [],
    });

    expect(execFileImpl).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "exec",
        "--sandbox",
        "read-only",
        "--cd",
        "/tmp/repo",
        "--model",
        "gpt-4.1",
      ]),
      expect.objectContaining({ cwd: "/tmp/repo", shell: false }),
    );
    expect(patch).toMatchObject({
      graphId: "g1",
      selectedNodeIds: ["a"],
      summary: "Improve selected node prompt.",
      operations: [{ type: "updateNode", nodeId: "a" }],
    });
  });

  it("reports missing Codex CLI as a setup issue", async () => {
    const missing = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    await expect(
      generateCodexSubgraphPatch({
        graphId: "g1",
        selectedNodeIds: ["a"],
        prompt: "Improve",
        mode: "improve",
        model: "gpt-4.1",
        nodes: [],
        edges: [],
        execFileImpl: vi.fn(async () => {
          throw missing;
        }),
      }),
    ).rejects.toThrow(/Codex CLI is not installed/i);
  });
});
