import { TRPCError } from "@trpc/server";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { IEdgeSpec, INodeSpec } from "@/db/models/graph.model";
import {
  PatchModeZ,
  SubgraphPatchZ,
  type SubgraphPatch,
} from "./subgraph-patch";
import type { z } from "zod";

const execFileAsync = promisify(execFile);
const MAX_GRAPH_JSON_CHARS = 20_000;
const MAX_CODEX_STDIO_CHARS = 6_000;

type ExecFileAsync = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
    shell: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;

export interface GenerateCodexSubgraphPatchInput {
  graphId: string;
  selectedNodeIds: string[];
  prompt: string;
  mode: z.infer<typeof PatchModeZ>;
  model: string;
  nodes: INodeSpec[];
  edges: IEdgeSpec[];
  cwd?: string;
  execFileImpl?: ExecFileAsync;
}

export async function generateCodexSubgraphPatch(
  input: GenerateCodexSubgraphPatchInput,
): Promise<SubgraphPatch> {
  const cwd = input.cwd ?? process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "orchestrator-codex-patch-"));
  const outputPath = path.join(tempDir, "last-message.json");

  try {
    const execImpl = input.execFileImpl ?? execFileAsync;
    await execImpl(
      "codex",
      [
        "exec",
        "--sandbox",
        "read-only",
        "--cd",
        cwd,
        "--model",
        input.model,
        "--output-last-message",
        outputPath,
        buildCodexPatchPrompt(input),
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 2 * 1024 * 1024,
        env: effectiveCodexEnv(),
        shell: false,
      },
    );

    const text = await readFile(outputPath, "utf8");
    return parseCodexPatchOutput(text);
  } catch (error) {
    if (isMissingExecutable(error)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Codex CLI is not installed or not visible to the Next server PATH. Install Codex CLI, authenticate it locally, and restart the server.",
      });
    }

    if (error instanceof TRPCError) throw error;

    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Codex CLI graph-patch proposal failed: ${safeErrorPreview(error)}`,
    });
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

function parseCodexPatchOutput(text: string): SubgraphPatch {
  if (!text.trim()) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "Codex CLI graph-patch response was empty.",
    });
  }

  try {
    return SubgraphPatchZ.parse(JSON.parse(extractJsonObject(text)));
  } catch (error) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message:
        error instanceof Error
          ? `Codex CLI graph-patch output failed schema validation: ${error.message}`
          : "Codex CLI graph-patch output failed schema validation.",
    });
  }
}

function buildCodexPatchPrompt(input: GenerateCodexSubgraphPatchInput): string {
  const selected = input.nodes.filter((node) => input.selectedNodeIds.includes(node.id));
  const graphJson = clip(
    JSON.stringify(
      {
        graphId: input.graphId,
        selectedNodeIds: input.selectedNodeIds,
        selectedNodes: selected,
        nodes: input.nodes,
        edges: input.edges,
      },
      null,
      2,
    ),
    MAX_GRAPH_JSON_CHARS,
  );

  return [
    "You are proposing a same-canvas patch for an AI workflow graph.",
    "You are running through local Codex CLI in read-only sandbox mode.",
    "Do not edit files. Return only the proposal JSON.",
    "Return ONLY valid JSON. Do not wrap it in markdown.",
    "The JSON must match this TypeScript shape exactly:",
    `{
  "graphId": string,
  "selectedNodeIds": string[],
  "summary": string,
  "rationale"?: string,
  "operations": [
    { "type": "updateNode", "nodeId": string, "patch": { "label"?: string, "position"?: { "x"?: number, "y"?: number }, "status"?: "pending" | "ready" | "running" | "paused" | "success" | "failed" | "skipped" | "blocked", "notes"?: string, "data"?: Record<string, unknown> } }
    | { "type": "addNode", "node": { "id": string, "kind": "plan" | "execute" | "review" | "doc" | "gate" | "context" | "loop", "label": string, "position": { "x": number, "y": number }, "status": "pending", "data": Record<string, unknown> } }
    | { "type": "deleteNode", "nodeId": string, "reason"?: string }
    | { "type": "addEdge", "edge": { "id": string, "source": string, "target": string, "kind": "flow" | "data" | "attaches-to" | "loop" } }
    | { "type": "deleteEdge", "edgeId": string, "reason"?: string }
    | { "type": "updateEdge", "edgeId": string, "patch": { "source"?: string, "target"?: string, "kind"?: "flow" | "data" | "attaches-to" | "loop" } }
  ],
  "warnings": string[],
  "requiresConfirmation"?: boolean
}`,
    "Rules:",
    "- Keep existing node and edge IDs unless adding new items.",
    "- New IDs must be short, stable, lowercase, and unique.",
    "- Do not create cycles with flow edges.",
    "- Prefer improving selected nodes in place; add nodes only when clearly helpful.",
    "- Do not delete nodes unless the user explicitly asked for deletion.",
    "- For execute nodes, put prompt changes under patch.data.prompt.",
    "- This is a proposal. The app will not mutate the graph until the user clicks Apply.",
    "",
    `Mode: ${input.mode}`,
    `User prompt: ${input.prompt}`,
    "",
    "Graph context:",
    graphJson,
  ].join("\n");
}

function effectiveCodexEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: process.env.ORCH_CLI_PATH_EXTRA
      ? [process.env.ORCH_CLI_PATH_EXTRA, process.env.PATH].filter(Boolean).join(path.delimiter)
      : process.env.PATH,
  };
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...<truncated>`;
}

function safeErrorPreview(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const stderr = "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = error instanceof Error ? error.message : String(error);
    return clip(`${message}${stderr ? `: ${stderr}` : ""}`, MAX_CODEX_STDIO_CHARS);
  }
  return clip(String(error), MAX_CODEX_STDIO_CHARS);
}

function isMissingExecutable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
