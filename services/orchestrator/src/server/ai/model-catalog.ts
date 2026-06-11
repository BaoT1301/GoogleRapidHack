import { checkCliAvailableSync, checkClaudeAvailableSync } from "../runtime/cli-capabilities";

export const AI_PATCH_PROVIDERS = ["gemini", "openai", "claude", "codex"] as const;
export type AiPatchProvider = (typeof AI_PATCH_PROVIDERS)[number];

export interface ModelCatalogModel {
  id: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  disabledReason?: string;
  quotaWarning?: string;
}

export interface ModelCatalogProvider {
  provider: AiPatchProvider;
  label: string;
  configured: boolean;
  enabled: boolean;
  disabledReason?: string;
  models: ModelCatalogModel[];
}

export interface ModelCatalogResponse {
  providers: ModelCatalogProvider[];
}

export interface AllowlistedModel {
  id: string;
  label: string;
}

export const MODEL_ALLOWLIST: Record<AiPatchProvider, AllowlistedModel[]> = {
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  claude: [
    { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
    { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet" },
    { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
  ],
  codex: [
    { id: "gpt-4.1", label: "GPT-4.1 via Codex CLI" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini via Codex CLI" },
    { id: "gpt-4o", label: "GPT-4o via Codex CLI" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini via Codex CLI" },
  ],
};

export function isMockPatchProviderEnabled(): boolean {
  return process.env.NODE_ENV === "test" && process.env.ORCH_AI_PATCH_MOCK === "1";
}

function hasCodexCli(): boolean {
  if (process.env.ORCH_TEST_CODEX_AVAILABLE === "1") return true;
  if (process.env.ORCH_TEST_CODEX_AVAILABLE === "0") return false;
  return checkCliAvailableSync("codex");
}

function providerLabel(provider: AiPatchProvider): string {
  switch (provider) {
    case "gemini":
      return "Gemini";
    case "openai":
      return "OpenAI / GPT";
    case "claude":
      return "Claude";
    case "codex":
      return "Codex CLI / GPT";
  }
}

export function getModelCatalog(): ModelCatalogResponse {
  const mockEnabled = isMockPatchProviderEnabled();
  const notConfiguredReason =
    "Selected-subgraph patch proposals are not configured for this provider.";

  const providers: ModelCatalogProvider[] = (["codex", "gemini", "openai", "claude"] as const).map(
    (provider) => {
      let configured = mockEnabled;
      if (provider === "codex") {
        configured = hasCodexCli();
      }
      if (provider === "claude") {
        configured = mockEnabled && checkClaudeAvailableSync();
      }
      const enabled = configured;
      const disabledReason = enabled
        ? undefined
        : provider === "codex"
          ? "Codex CLI is not installed or not visible to the Next server PATH."
          : provider === "gemini"
          ? "Selected-node improvement uses Codex CLI / GPT; direct Gemini API patching is not enabled."
          : provider === "claude" && !checkClaudeAvailableSync()
          ? "Claude CLI is not installed or authenticated on this machine."
          : notConfiguredReason;

      return {
        provider,
        label: providerLabel(provider),
        configured,
        enabled,
        disabledReason,
        models: MODEL_ALLOWLIST[provider].map((model) => ({
          ...model,
          configured,
          enabled,
          disabledReason,
          quotaWarning: enabled
            ? mockEnabled
              ? "Dev/test mock proposal path only; no real AI provider call is made."
              : provider === "codex"
                ? "Uses local Codex CLI auth/config; no app API key is required."
                : undefined
            : undefined,
        })),
      };
    },
  );

  return { providers };
}

export function getEnabledModel(provider: AiPatchProvider, modelId: string): ModelCatalogModel | null {
  const catalogProvider = getModelCatalog().providers.find((entry) => entry.provider === provider);
  const model = catalogProvider?.models.find((entry) => entry.id === modelId);
  if (!catalogProvider || !model || !catalogProvider.enabled || !model.enabled) return null;
  return model;
}

export function isAllowlistedModel(provider: AiPatchProvider, modelId: string): boolean {
  return MODEL_ALLOWLIST[provider].some((model) => model.id === modelId);
}

export function isAnyAllowlistedModel(modelId: string): boolean {
  return AI_PATCH_PROVIDERS.some((provider) => isAllowlistedModel(provider, modelId));
}
