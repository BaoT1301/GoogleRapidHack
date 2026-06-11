import { TRPCError } from "@trpc/server";
import { execFileSync } from "node:child_process";
import { checkCliAvailableSync, checkClaudeAvailableSync } from "../runtime/cli-capabilities";
import {
  AI_PATCH_PROVIDERS,
  getModelCatalog,
  isAnyAllowlistedModel,
  isAllowlistedModel,
  type AiPatchProvider,
  type ModelCatalogResponse,
} from "./model-catalog";

export const MODEL_ROUTER_TASKS = [
  "planning",
  "graph_patch",
  "code_editing",
  "code_review",
  "docs",
  "summary",
  "quick_fix",
] as const;

export type ModelRouterTask = (typeof MODEL_ROUTER_TASKS)[number];
export type ModelRouterProvider = AiPatchProvider | "cloud" | "local";

export interface ModelRouteRequest {
  taskType: ModelRouterTask;
  provider?: ModelRouterProvider | "auto";
  model?: string;
  catalog?: ModelCatalogResponse;
}

export interface ModelRouteSelection {
  taskType: ModelRouterTask;
  provider: ModelRouterProvider;
  model: string;
  automatic: boolean;
  reason: string;
}

const STRONG_REASONING: Array<[AiPatchProvider, string]> = [
  ["codex", "gpt-4.1"],
  ["gemini", "gemini-2.5-pro"],
  ["openai", "gpt-4.1"],
  ["claude", "claude-sonnet-4"],
  ["codex", "gpt-4o"],
  ["gemini", "gemini-1.5-pro"],
  ["openai", "gpt-4o"],
];

const FAST_CHEAP: Array<[AiPatchProvider, string]> = [
  ["codex", "gpt-4.1-mini"],
  ["gemini", "gemini-2.0-flash"],
  ["openai", "gpt-4.1-mini"],
  ["openai", "gpt-4o-mini"],
  ["gemini", "gemini-1.5-flash"],
];

export function routeModel(input: ModelRouteRequest): ModelRouteSelection {
  const provider = input.provider ?? "auto";
  const model = normalizeModel(input.model);

  if (provider !== "auto") {
    return validateManualRoute({
      taskType: input.taskType,
      provider,
      model,
      catalog: input.catalog,
    });
  }

  return routeAutomatic({
    taskType: input.taskType,
    catalog: input.catalog ?? getModelCatalog(),
  });
}

function validateManualRoute(input: {
  taskType: ModelRouterTask;
  provider: ModelRouterProvider;
  model?: string;
  catalog?: ModelCatalogResponse;
}): ModelRouteSelection {
  if (input.provider === "cloud" || input.provider === "local") {
    if (input.provider === "local" && !checkKiroAvailableSync()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Local planner (kiro-cli) is not installed or configured on this machine.",
      });
    }
    if (input.model && input.model !== "auto" && !isAnyAllowlistedModel(input.model) && input.model !== "local-planner-default") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `planner model is not allowlisted: ${input.model}`,
      });
    }
    return {
      taskType: input.taskType,
      provider: input.provider,
      model: input.model && input.model !== "auto" ? input.model : plannerDefaultModel(input.provider),
      automatic: false,
      reason:
        input.model && input.model !== "auto"
          ? "Manual planner model label accepted for display; backend provider may still use its configured default."
          : "Manual planner provider selected; backend provider uses its configured default model.",
    };
  }

  if (!AI_PATCH_PROVIDERS.includes(input.provider)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `unsupported provider: ${input.provider}` });
  }
  if (input.provider === "claude" && !checkClaudeAvailableSync()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Claude provider is not available. Please install and authenticate Claude CLI.",
    });
  }
  if (!input.model || input.model === "auto") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "manual provider selection requires an exact allowlisted model id" });
  }
  if (!isAllowlistedModel(input.provider, input.model)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `model is not allowlisted for provider ${input.provider}: ${input.model}`,
    });
  }

  const enabled = getEnabledFromCatalog(input.catalog ?? getModelCatalog(), input.provider, input.model);
  if (!enabled) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `model is not enabled for provider ${input.provider}: ${input.model}`,
    });
  }

  return {
    taskType: input.taskType,
    provider: input.provider,
    model: input.model,
    automatic: false,
    reason: "Manual provider/model override validated against the backend allowlist.",
  };
}

function checkKiroAvailableSync(): boolean {
  if (process.env.ORCH_TEST_KIRO_AVAILABLE === "1") return true;
  if (process.env.ORCH_TEST_KIRO_AVAILABLE === "0") return false;

  if (!checkCliAvailableSync("kiro-cli")) return false;
  if (process.env.KIRO_API_KEY) return true;
  try {
    execFileSync("kiro-cli", ["whoami"], {
      stdio: "ignore",
      timeout: 1000,
      shell: process.platform === "win32"
    });
    return true;
  } catch {
    return false;
  }
}

function routeAutomatic(input: {
  taskType: ModelRouterTask;
  catalog: ModelCatalogResponse;
}): ModelRouteSelection {
  if (input.taskType === "planning") {
    const kiroAvailable = checkKiroAvailableSync();
    if (process.env.LLM_API_URL || process.env.LLM_PROXY_URL) {
      return {
        taskType: input.taskType,
        provider: "cloud",
        model: process.env.ORCH_PLAN_MODEL || "gemini-2.5-pro",
        automatic: true,
        reason: kiroAvailable
          ? "Auto selected the configured Cloud planner for planning tasks."
          : "Auto selected the configured Cloud planner for planning tasks (Local Kiro is not installed/configured).",
      };
    }
    if (kiroAvailable) {
      return {
        taskType: input.taskType,
        provider: "local",
        model: "local-planner-default",
        automatic: true,
        reason: "Auto fell back to the Local planner because no Cloud planner URL is configured.",
      };
    }
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No planning provider is available. Configure LLM_API_URL for Cloud planner, or install and configure kiro-cli for Local planner.",
    });
  }

  if (input.taskType === "code_editing" && process.env.ORCH_CODEX_MODEL_ROUTER === "1") {
    return {
      taskType: input.taskType,
      provider: "codex",
      model: "gpt-4.1",
      automatic: true,
      reason: "Auto selected Codex for code editing because Codex routing is configured.",
    };
  }

  const candidates = candidatesFor(input.taskType);
  const selected = candidates.find(([provider, model]) =>
    getEnabledFromCatalog(input.catalog, provider, model),
  );
  if (selected) {
    const [provider, model] = selected;
    return {
      taskType: input.taskType,
      provider,
      model,
      automatic: true,
      reason: reasonForTask(input.taskType),
    };
  }

  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `no configured model is available for task type ${input.taskType}`,
  });
}

function candidatesFor(taskType: ModelRouterTask): Array<[AiPatchProvider, string]> {
  switch (taskType) {
    case "graph_patch":
      return STRONG_REASONING;
    case "code_review":
    case "docs":
    case "summary":
    case "quick_fix":
      return FAST_CHEAP;
    case "code_editing":
      return [...FAST_CHEAP, ...STRONG_REASONING];
    case "planning":
      return STRONG_REASONING;
  }
}

function reasonForTask(taskType: ModelRouterTask): string {
  switch (taskType) {
    case "graph_patch":
      return "Auto selected local Codex CLI with a strong GPT model for graph patching.";
    case "code_review":
      return "Auto selected a fast configured model for code review.";
    case "docs":
      return "Auto selected a fast configured model for documentation work.";
    case "summary":
      return "Auto selected a fast configured model for summarization.";
    case "quick_fix":
      return "Auto selected a fast configured model for quick fixes.";
    case "code_editing":
      return "Auto fell back to a configured fast model because Codex routing is unavailable.";
    case "planning":
      return "Auto selected a configured reasoning model for planning.";
  }
}

function getEnabledFromCatalog(
  catalog: ModelCatalogResponse,
  provider: AiPatchProvider,
  modelId: string,
): boolean {
  const catalogProvider = catalog.providers.find((entry) => entry.provider === provider);
  const model = catalogProvider?.models.find((entry) => entry.id === modelId);
  return Boolean(catalogProvider?.enabled && model?.enabled);
}

function plannerDefaultModel(provider: "cloud" | "local"): string {
  return provider === "cloud" ? process.env.ORCH_PLAN_MODEL || "gemini-2.5-pro" : "local-planner-default";
}

function normalizeModel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
