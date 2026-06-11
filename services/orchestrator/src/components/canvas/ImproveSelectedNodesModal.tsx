"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SparkleIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import {
  getLastUsedAgent,
  saveLastUsedAgent,
  getLastUsedModel,
  saveLastUsedModel,
} from "@/lib/last-used-agent";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { GraphPatchPreview } from "./GraphPatchPreview";
import type { AppNode } from "@/components/canvas/serialize";
import type { CanvasSubgraphPatch } from "./graphPatch";

const SUGGESTIONS = [
  "Fix this workflow",
  "Make this more robust",
  "Add tests",
  "Split into parallel agents",
  "Improve error handling",
];

type PatchMode = "fix" | "improve" | "expand" | "refactor";
type ProviderId = "gemini" | "openai" | "claude" | "codex";
type ProviderChoice = ProviderId | "auto";

interface CatalogModel {
  id: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  disabledReason?: string;
  quotaWarning?: string;
}

interface CatalogProvider {
  provider: ProviderId;
  label: string;
  configured: boolean;
  enabled: boolean;
  disabledReason?: string;
  models: CatalogModel[];
}

interface ProposalResponse {
  proposalId: string;
  graphId: string;
  provider: ProviderId;
  model: string;
  modelSelection?: {
    automatic: boolean;
    reason: string;
    taskType: string;
    provider: string;
    model: string;
  };
  patch: CanvasSubgraphPatch;
}

export function ImproveSelectedNodesModal({
  open,
  graphId,
  selectedNodes,
  onClose,
  onApplyProposal,
  onGeneratingChange,
}: {
  open: boolean;
  graphId: string;
  selectedNodes: AppNode[];
  onClose: () => void;
  onApplyProposal: (proposal: ProposalResponse) => Promise<void> | void;
  onGeneratingChange?: (generating: boolean) => void;
}) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<PatchMode>("improve");
  const [providerId, setProviderId] = useState<ProviderChoice>("auto");
  const [modelId, setModelId] = useState("");
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [isDefaulted, setIsDefaulted] = useState(false);

  const catalogQuery = useQuery({
    ...trpc.ai.modelCatalog.queryOptions(),
    enabled: open,
  });
  const providers = (catalogQuery.data?.providers ?? []) as CatalogProvider[];

  const selectedProvider = providers.find((provider) => provider.provider === providerId);
  const models = selectedProvider?.models ?? [];
  const selectedModel = models.find((model) => model.id === modelId);
  const autoSelected = providerId === "auto";
  const hasEnabledGraphPatchModel = providers.some(
    (provider) => provider.enabled && provider.models.some((model) => model.enabled),
  );
  const autoUnavailableMessage =
    "No graph-patch model is configured. Install/authenticate Codex CLI and make sure the Next server PATH can find `codex`.";
  const canGenerate =
    selectedNodes.length > 0 &&
    prompt.trim().length > 0 &&
    (autoSelected
      ? hasEnabledGraphPatchModel
      : Boolean(selectedProvider?.enabled) && Boolean(selectedModel?.enabled));

  const lastAgent = getLastUsedAgent();
  const lastAgentName = lastAgent ? lastAgent.charAt(0).toUpperCase() + lastAgent.slice(1) : "";

  useEffect(() => {
    if (!open || providers.length === 0) {
      setIsDefaulted(false);
      return;
    }
    const lastProvider = lastAgent === "kiro" ? "gemini" : lastAgent;
    const matchedProvider = providers.find((p) => p.provider === lastProvider && p.enabled);

    if (matchedProvider) {
      setProviderId(matchedProvider.provider as ProviderChoice);
      setIsDefaulted(true);

      const lastModel = getLastUsedModel(matchedProvider.provider);
      const matchedModel = lastModel
        ? matchedProvider.models.find((m) => m.id === lastModel && m.enabled)
        : null;
      if (matchedModel) {
        setModelId(matchedModel.id);
      } else {
        const firstEnabledModel = matchedProvider.models.find((m) => m.enabled);
        setModelId(firstEnabledModel?.id ?? "");
      }
    } else {
      setProviderId("auto");
      setModelId("auto");
      setIsDefaulted(false);
    }
  }, [open, providers, lastAgent]);

  useEffect(() => {
    if (autoSelected) {
      setModelId("auto");
      return;
    }
    if (!selectedProvider) return;
    if (modelId !== "auto" && !models.some((model) => model.id === modelId)) {
      setModelId(models.find((model) => model.enabled)?.id ?? "");
    }
  }, [autoSelected, selectedProvider, models, modelId]);

  const propose = useMutation(
    trpc.ai.proposeSubgraphPatch.mutationOptions({
      onSuccess: (nextProposal: ProposalResponse) => {
        setProposal(nextProposal);
        if (providerId !== "auto" && providerId) {
          saveLastUsedAgent(providerId);
          if (modelId && modelId !== "auto") {
            saveLastUsedModel(providerId, modelId);
          }
        }
      },
      onError: (error: { message?: string }) =>
        toast(error.message ?? "Failed to generate AI proposal", "error"),
    }),
  );

  const apply = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("No proposal to apply");
      await onApplyProposal(proposal);
    },
    onSuccess: () => {
      toast("AI changes applied.", "success");
      close();
    },
    onError: (error: { message?: string }) =>
      toast(error.message ?? "Failed to apply AI proposal", "error"),
  });

  useEffect(() => {
    onGeneratingChange?.(propose.isPending);
  }, [onGeneratingChange, propose.isPending]);

  const selectedSummary = useMemo(
    () =>
      selectedNodes.map((node) => ({
        id: node.id,
        label: node.data.label,
        kind: node.data.kind,
      })),
    [selectedNodes],
  );

  function close() {
    setPrompt("");
    setMode("improve");
    setProviderId("auto");
    setModelId("auto");
    setProposal(null);
    propose.reset();
    apply.reset();
    onGeneratingChange?.(false);
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canGenerate || !providerId) return;
    propose.mutate({
      graphId,
      selectedNodeIds: selectedNodes.map((node) => node.id),
      prompt: prompt.trim(),
      provider: providerId,
      model: autoSelected ? "auto" : modelId,
      mode,
    });
  }

  return (
    <Dialog open={open} onClose={close} title="Improve selected nodes with AI">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-surface/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            {selectedNodes.length} selected node{selectedNodes.length === 1 ? "" : "s"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedSummary.map((node) => (
              <span
                key={node.id}
                className="rounded-full border border-border bg-panel px-2 py-1 text-[11px] text-muted"
              >
                {node.label} · {node.kind}
              </span>
            ))}
          </div>
        </div>

        <Field label="Prompt" htmlFor="ai-improve-prompt">
          <Textarea
            id="ai-improve-prompt"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe how AI should improve the selected subgraph…"
          />
        </Field>

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setPrompt(suggestion)}
              className="rounded-full border border-border bg-panel px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-content"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value as PatchMode)}>
            <option value="fix">fix</option>
            <option value="improve">improve</option>
            <option value="expand">expand</option>
            <option value="refactor">refactor</option>
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Provider"
            hint={
              autoSelected && hasEnabledGraphPatchModel
                ? "Backend will choose the best configured provider/model for graph patching."
                : selectedProvider && !selectedProvider.enabled
                  ? selectedProvider.disabledReason
                  : undefined
            }
            error={
              catalogQuery.isError
                ? "Model catalog unavailable"
                : autoSelected && !catalogQuery.isLoading && !hasEnabledGraphPatchModel
                  ? autoUnavailableMessage
                  : undefined
            }
          >
            <Select
              value={providerId}
              disabled={catalogQuery.isLoading || providers.length === 0}
              onChange={(e) => {
                const nextProvider = e.target.value as ProviderChoice;
                setIsDefaulted(false);
                if (nextProvider === "auto") {
                  setProviderId("auto");
                  setModelId("auto");
                  return;
                }
                const provider = providers.find((entry) => entry.provider === nextProvider);
                setProviderId(nextProvider);
                setModelId(provider?.models.find((model) => model.enabled)?.id ?? "");
              }}
            >
              <option value="auto">Auto-select best model</option>
              {providers.map((provider) => (
                <option key={provider.provider} value={provider.provider} disabled={!provider.enabled}>
                  {provider.label}{provider.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </Select>
            {isDefaulted && lastAgentName && (
              <p className="text-[11px] text-accent mt-1">
                Defaulted to your last used agent: {lastAgentName}
              </p>
            )}
          </Field>

          <Field
            label="Model"
            hint={
              autoSelected
                ? hasEnabledGraphPatchModel
                  ? "The chosen provider/model and reason will appear in the proposal preview."
                  : autoUnavailableMessage
                : selectedModel && !selectedModel.enabled
                  ? selectedModel.disabledReason
                  : selectedModel?.quotaWarning
            }
          >
            <Select
              value={autoSelected ? "auto" : modelId}
              disabled={autoSelected || !selectedProvider || models.length === 0}
              onChange={(e) => {
                setIsDefaulted(false);
                setModelId(e.target.value);
              }}
            >
              {autoSelected && <option value="auto">Auto-selected by backend</option>}
              <option value="">Choose model</option>
              {models.map((model) => (
                <option key={model.id} value={model.id} disabled={!model.enabled}>
                  {model.label}{model.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {proposal && (
          <GraphPatchPreview
            patch={proposal.patch}
            provider={proposal.provider}
            model={proposal.model}
            modelReason={proposal.modelSelection?.reason}
          />
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          {proposal && (
            <Button
              type="button"
              variant="ghost"
              disabled={!canGenerate}
              loading={propose.isPending}
              onClick={() => {
                setProposal(null);
                if (!providerId) return;
                propose.mutate({
                  graphId,
                  selectedNodeIds: selectedNodes.map((node) => node.id),
                  prompt: prompt.trim(),
                  provider: providerId,
                  model: autoSelected ? "auto" : modelId,
                  mode,
                });
              }}
            >
              Regenerate
            </Button>
          )}
          {!proposal ? (
            <Button type="submit" loading={propose.isPending} disabled={!canGenerate}>
              <SparkleIcon size={13} weight="fill" /> Generate proposal
            </Button>
          ) : (
            <Button type="button" loading={apply.isPending} onClick={() => apply.mutate()}>
              Apply to canvas
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
