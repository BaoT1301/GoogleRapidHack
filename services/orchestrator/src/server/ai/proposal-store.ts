import type { AiPatchProvider } from "./model-catalog";
import type { SubgraphPatch } from "./subgraph-patch";

export interface StoredSubgraphProposal {
  proposalId: string;
  ownerId: string;
  graphId: string;
  provider: AiPatchProvider;
  model: string;
  patch: SubgraphPatch;
  createdAt: string;
}

const g = globalThis as typeof globalThis & {
  __orchSubgraphPatchProposals?: Map<string, StoredSubgraphProposal>;
};

const store = g.__orchSubgraphPatchProposals ?? new Map<string, StoredSubgraphProposal>();
g.__orchSubgraphPatchProposals = store;

function makeProposalId(): string {
  return `proposal_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export function saveSubgraphProposal(input: Omit<StoredSubgraphProposal, "proposalId" | "createdAt">): StoredSubgraphProposal {
  const proposal: StoredSubgraphProposal = {
    ...input,
    proposalId: makeProposalId(),
    createdAt: new Date().toISOString(),
  };
  store.set(proposal.proposalId, proposal);
  return proposal;
}

export function getSubgraphProposal(input: {
  ownerId: string;
  graphId?: string;
  proposalId: string;
}): StoredSubgraphProposal | null {
  const proposal = store.get(input.proposalId);
  if (!proposal || proposal.ownerId !== input.ownerId) return null;
  if (input.graphId && proposal.graphId !== input.graphId) return null;
  return proposal;
}

export function clearSubgraphProposalsForTest(): void {
  store.clear();
}
