import { TRPCError } from "@trpc/server";
import { connectDB } from "@/db/client";
import { resolvePersona } from "../templates/resolve-template";
import {
  PlanResultSchema,
  type ContextRequest,
  type GraphSpec,
  type PlanResult,
} from "./schemas";
import {
  resolveCodebaseContext,
  type CodebaseContext,
} from "./codebase-context";
import {
  resolvePlanProviderName,
} from "./index";
import { routeModel, type ModelRouteSelection } from "../ai/model-router";
import { CloudArchitectProvider } from "./cloud-architect-provider";
import { LocalCliArchitectProvider } from "./local-cli-architect-provider";
import type {
  PlanGenerateInput,
  PlanProvider,
  PlanProviderName,
} from "./types";

const RAW_PREVIEW_LIMIT = 4000;

export type PlannerSource = "plan_panel" | "plan_node_runtime";

export interface GeneratePlanInput {
  prompt: string;
  messages?: { role: "user" | "assistant"; content: string }[];
  approved?: boolean;
  persona?: string;
  provider?: PlanProviderName | string;
  model?: string;
  codebaseContext?: unknown;
  ownerId?: string;
  source?: PlannerSource;
}

export interface GeneratePlanResult {
  provider: PlanProviderName;
  model?: string;
  resultType: "context_request" | "graph_spec";
  contextRequest?: ContextRequest;
  graphSpec?: GraphSpec;
  warnings: string[];
  rawPreview?: unknown;
  /**
   * Public `plan.generate` intentionally returns this unchanged to preserve the
   * existing top-level ContextRequest | GraphSpec contract.
   */
  rawResult: unknown;
}

export interface GeneratePlanDeps {
  selectProvider?: (provider: PlanProviderName) => PlanProvider;
  resolveContext?: (hint: unknown) => Promise<CodebaseContext | undefined>;
  resolveWorkspacePersona?: (
    ownerId: string,
    personaId: string,
  ) => Promise<{ id?: string; content: string; version?: string } | undefined>;
}

export async function generatePlan(
  input: GeneratePlanInput,
  deps: GeneratePlanDeps = {},
): Promise<GeneratePlanResult> {
  const providerName = resolvePlanProviderName(
    input.provider === "auto"
      ? routeModel({ taskType: "planning", provider: "auto", model: input.model }).provider as PlanProviderName
      : input.provider === "cloud" || input.provider === "local"
        ? input.provider
        : undefined,
  );
  const warnings: string[] = [];
  const modelSelection = resolvePlanningModelSelection(input, providerName);
  if (modelSelection.automatic) warnings.push(modelSelection.reason);
  if (!modelSelection.automatic && input.model) warnings.push(modelSelection.reason);

  const codebaseContext = await (deps.resolveContext
    ? deps.resolveContext(input.codebaseContext)
    : resolveCodebaseContext(input.codebaseContext));

  const resolvedPersona = await resolvePlannerPersona({
    ownerId: input.ownerId,
    persona: input.persona,
    deps,
  });

  const request: PlanGenerateInput = {
    prompt: input.prompt,
    messages: input.messages ?? [],
    approved: input.approved ?? false,
    ...(input.persona ? { persona: input.persona } : {}),
    ...(codebaseContext ? { codebaseContext } : {}),
    ...(resolvedPersona ? { resolvedPersona } : {}),
  };

  try {
    const provider = deps.selectProvider
      ? deps.selectProvider(providerName)
      : defaultProvider(providerName);
    const rawResult = await provider.generate(request);
    const normalized = normalizePlanResult(rawResult);
    warnings.push(...normalized.warnings);

    return {
      provider: provider.name,
      model: readModel(rawResult) ?? modelSelection.model,
      resultType: normalized.resultType,
      contextRequest: normalized.contextRequest,
      graphSpec: normalized.graphSpec,
      warnings,
      rawPreview: previewRaw(rawResult),
      rawResult,
    };
  } catch (error) {
    throw normalizeProviderError(error, providerName);
  }
}

function resolvePlanningModelSelection(
  input: GeneratePlanInput,
  providerName: PlanProviderName,
): ModelRouteSelection {
  if (input.provider === "auto" || normalizeModel(input.model) === "auto") {
    return routeModel({ taskType: "planning", provider: "auto", model: "auto" });
  }
  return routeModel({
    taskType: "planning",
    provider: providerName,
    model: input.model,
  });
}

function defaultProvider(provider: PlanProviderName): PlanProvider {
  return provider === "local"
    ? new LocalCliArchitectProvider()
    : new CloudArchitectProvider();
}

async function resolvePlannerPersona(input: {
  ownerId?: string;
  persona?: string;
  deps: GeneratePlanDeps;
}): Promise<{ id?: string; content: string; version?: string } | undefined> {
  if (!input.ownerId || !input.persona) return undefined;
  if (input.deps.resolveWorkspacePersona) {
    return input.deps.resolveWorkspacePersona(input.ownerId, input.persona);
  }
  try {
    await connectDB();
    const resolved = await resolvePersona(input.ownerId, input.persona);
    if (resolved?.source !== "workspace") return undefined;
    return {
      id: resolved.id,
      content: resolved.content,
      version: resolved.version,
    };
  } catch {
    return undefined;
  }
}

function normalizePlanResult(raw: unknown): {
  resultType: "context_request" | "graph_spec";
  contextRequest?: ContextRequest;
  graphSpec?: GraphSpec;
  warnings: string[];
} {
  const rawType = readType(raw);
  const resultType = rawType === "graph_spec" ? "graph_spec" : "context_request";
  const parsed = PlanResultSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      resultType,
      warnings: [
        `Planner returned ${rawType ?? "unknown"} output that does not fully validate: ${parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("; ")}`,
      ],
    };
  }

  return typedResult(parsed.data);
}

function typedResult(result: PlanResult): {
  resultType: "context_request" | "graph_spec";
  contextRequest?: ContextRequest;
  graphSpec?: GraphSpec;
  warnings: string[];
} {
  if (result.type === "graph_spec") {
    return { resultType: "graph_spec", graphSpec: result, warnings: [] };
  }
  return { resultType: "context_request", contextRequest: result, warnings: [] };
}

function readType(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const type = (raw as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

function readModel(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const model = (raw as { model?: unknown }).model;
  return typeof model === "string" ? model : undefined;
}

function normalizeModel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function previewRaw(raw: unknown): unknown {
  try {
    const text = JSON.stringify(raw);
    if (!text || text.length <= RAW_PREVIEW_LIMIT) return raw;
    return `${text.slice(0, RAW_PREVIEW_LIMIT)}… [truncated]`;
  } catch {
    return "[unserializable planner result]";
  }
}

function normalizeProviderError(error: unknown, provider: PlanProviderName): TRPCError {
  if (error instanceof TRPCError) return error;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown planner provider failure";
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `Planner provider "${provider}" failed: ${message}`,
  });
}
