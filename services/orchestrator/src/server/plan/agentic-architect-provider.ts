import { TRPCError } from "@trpc/server";
import { extractPlanJson, formatCodebaseContext } from "./planner-prompt";
import { parsePlanResult } from "./schemas";
import type { PlanGenerateInput, PlanProvider } from "./types";
import { CloudArchitectProvider } from "./cloud-architect-provider";

/**
 * Agentic cloud planner (Track A — the conductor).
 *
 * Unlike the one-shot CloudArchitectProvider (bake context in → one /plan call),
 * this runs the loop: it drives the tool-capable `/api/v1/generate` endpoint
 * turn-by-turn and answers the model's `query_codebase` calls LOCALLY from the
 * project's KB. So the cloud planner reasons AGENTICALLY (asks the codebase
 * questions as it thinks) while the KB never leaves the orchestrator and Gemini's
 * context stays lean (only the slices it asks for). Contract:
 * `.claude/docs/core/api-contracts/agentic-generate-api.md`.
 *
 * Bounded: ≤ maxIterations turns and ≤ maxToolCalls total tool calls; on exhaustion
 * (or any failure) the caller falls back to the one-shot cloud planner.
 */
const PLAN_SENTINEL_OPEN = "<!-- orch:plan -->";
const PLAN_SENTINEL_CLOSE = "<!-- /orch:plan -->";

const QUERY_CODEBASE_TOOL = {
  name: "query_codebase",
  description:
    "Search the user's real repository index for relevant symbols and files. " +
    "Use it to ground the plan in the actual code (e.g. find where auth, routing, " +
    "or a feature lives). Returns matching symbols and files.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "what to look for (keywords)" },
      limit: { type: "number", description: "max results (optional)" },
    },
    required: ["query"],
  },
} as const;

type Msg = { role: "user" | "assistant"; content: string };
export type GenerateTurnFn = (input: {
  system: string;
  messages: Msg[];
  tools: { name: string; description?: string; parameters: Record<string, unknown> }[];
}) => Promise<{ kind: "text"; text: string } | { kind: "tool_calls"; calls: { name: string; args: Record<string, unknown> }[] }>;

/** Serves the query_codebase tool from the project KB (bounded, secret-free). */
export type QueryCodebaseFn = (
  query: string,
  limit?: number,
) => Promise<{ symbols: string[]; files: string[] }>;

export interface AgenticProviderDeps {
  /** REQUIRED: answers query_codebase from the project's KB (plan.ts injects this). */
  queryCodebase: QueryCodebaseFn;
  /** One agentic turn. Defaults to an HTTP call to LLM_API_URL/api/v1/generate. */
  generateTurn?: GenerateTurnFn;
  maxIterations?: number;
  maxToolCalls?: number;
}

function buildSystemPrompt(): string {
  return [
    "You are product_architect, a senior software architect who plans software",
    "features as a directed acyclic graph (DAG) of work tracks.",
    "",
    "You can call the `query_codebase` tool to inspect the user's REAL repository",
    "(it returns matching symbols and files). Call it whenever you need to ground",
    "your plan in the actual code — find where the relevant modules live, what",
    "exists already, what to extend. Make as many calls as you need, then stop and",
    "output your answer.",
    "",
    "Output contract — reply with a SINGLE JSON object wrapped in",
    `${PLAN_SENTINEL_OPEN} and ${PLAN_SENTINEL_CLOSE}:`,
    "- Socratic mode (not yet confident): a context_request —",
    '  {"type":"context_request","confidence":0..1,"readyToPlan":false,',
    '   "codebaseImpact":"...","approaches":[{"name":"...","pros":[],"cons":[]}],',
    '   "questions":[{"id":"q1","text":"..."}],"missingContext":[]}',
    "- Approved/confident: a graph_spec (the execution DAG) —",
    '  {"type":"graph_spec","version":"1.0","featureName":"...",',
    '   "tracks":[{"id":"t1","number":1,"name":"..."}]}',
    "",
    "Output ONLY the JSON object inside the sentinels — no prose outside it.",
  ].join("\n");
}

function buildUserMessage(input: PlanGenerateInput): string {
  const mode = input.approved
    ? "Mode: APPROVED — produce the graph_spec execution DAG now."
    : "Mode: Socratic — produce a context_request (codebase impact + 4-5 approaches + 5-20 clarifying questions). Do NOT plan tracks yet.";
  const transcript =
    input.messages.length > 0
      ? input.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")
      : "(no prior turns)";
  const codebaseContext = formatCodebaseContext(input.codebaseContext);
  return [
    mode,
    "",
    ...(codebaseContext ? [codebaseContext, ""] : []),
    "## Conversation so far",
    transcript,
    "",
    "## Feature request",
    input.prompt,
  ].join("\n");
}

function formatToolResult(r: { symbols: string[]; files: string[] }): string {
  const lines = ["query_codebase result:"];
  lines.push(`files (${r.files.length}): ${r.files.slice(0, 40).join(", ") || "(none)"}`);
  lines.push(`symbols (${r.symbols.length}):`);
  for (const s of r.symbols.slice(0, 40)) lines.push(`- ${s}`);
  return lines.join("\n");
}

/** Default turn runner — POST to the services/llm /api/v1/generate endpoint. */
const defaultGenerateTurn: GenerateTurnFn = async ({ system, messages, tools }) => {
  const url = process.env.LLM_API_URL ?? process.env.LLM_PROXY_URL;
  if (!url) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM_API_URL not configured" });
  }
  const res = await fetch(`${url}/api/v1/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Service-Token": process.env.LLM_SERVICE_TOKEN ?? "" },
    body: JSON.stringify({ system, messages, tools }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new TRPCError({
      code: res.status === 429 ? "TOO_MANY_REQUESTS" : "INTERNAL_SERVER_ERROR",
      message: res.status === 429 ? "Architect API is rate-limited — retry shortly." : `LLM generate error: ${res.status}`,
    });
  }
  return (await res.json()) as Awaited<ReturnType<GenerateTurnFn>>;
};

export class AgenticArchitectProvider implements PlanProvider {
  readonly name = "cloud" as const;
  private readonly queryCodebase: QueryCodebaseFn;
  private readonly generateTurn: GenerateTurnFn;
  private readonly maxIterations: number;
  private readonly maxToolCalls: number;

  constructor(deps: AgenticProviderDeps) {
    this.queryCodebase = deps.queryCodebase;
    this.generateTurn = deps.generateTurn ?? defaultGenerateTurn;
    this.maxIterations = deps.maxIterations ?? 6;
    this.maxToolCalls = deps.maxToolCalls ?? 8;
  }

  async generate(input: PlanGenerateInput): Promise<unknown> {
    const system = buildSystemPrompt();
    const messages: Msg[] = [{ role: "user", content: buildUserMessage(input) }];
    let toolCalls = 0;
    let lastError = "no answer produced";

    for (let i = 0; i < this.maxIterations; i++) {
      const turn = await this.generateTurn({ system, messages, tools: [QUERY_CODEBASE_TOOL] });

      if (turn.kind === "tool_calls") {
        for (const call of turn.calls) {
          if (toolCalls >= this.maxToolCalls) break;
          toolCalls++;
          if (call.name === "query_codebase") {
            const query = typeof call.args.query === "string" ? call.args.query : input.prompt;
            const limit = typeof call.args.limit === "number" ? call.args.limit : undefined;
            const result = await this.queryCodebase(query, limit).catch(() => ({ symbols: [], files: [] }));
            messages.push({ role: "assistant", content: `[called query_codebase(${query})]` });
            messages.push({ role: "user", content: formatToolResult(result) });
          } else {
            messages.push({ role: "user", content: `Tool ${call.name} is not available. Use query_codebase or answer now.` });
          }
        }
        continue;
      }

      // Final text → parse the plan JSON (lenient extract + zod validate).
      const json = extractPlanJson(turn.text);
      if (json === null) {
        lastError = "the planner produced no JSON object";
      } else {
        const parsed = parsePlanResult(json);
        if (parsed.ok) return parsed.value;
        lastError = `the planner's JSON ${parsed.error}`;
      }
      // Nudge it to fix and continue within the iteration budget.
      messages.push({
        role: "user",
        content: `Your previous reply was not a valid plan (${lastError}). Reply with ONLY the JSON object inside ${PLAN_SENTINEL_OPEN}…${PLAN_SENTINEL_CLOSE}.`,
      });
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Agentic planner produced no usable plan after ${this.maxIterations} turns: ${lastError}.`,
    });
  }

  /** Reuse the Cloud Architect reachability snapshot. */
  async health(): Promise<unknown> {
    return new CloudArchitectProvider().health();
  }
}
