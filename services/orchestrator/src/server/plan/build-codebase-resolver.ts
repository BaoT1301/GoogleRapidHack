/**
 * Shared codebase-context resolver assembly (P2 + P3).
 *
 * One place that composes "structural facts from mcp-context-manager (P3),
 * falling back to the local repo file-scan (P2)" so both `plan.generate` and the
 * KB sync flow use identical logic (Do-Not-Invent). Both layers are best-effort
 * and yield undefined when unavailable, keeping every caller byte-compatible.
 */
import type { CodebaseContext } from "./codebase-context";
import { createMcpContextResolver } from "./mcp-context-resolver";
import { createRepoSummaryResolver } from "./repo-summary-resolver";

/** The configured mcp-context-manager URL, or undefined (→ pure file-scan). */
export function resolveMcpUrl(): string | undefined {
  return process.env.MCP_CONTEXT_URL?.trim() || undefined;
}

/** The repo path to summarize: explicit → ORCH_PLAN_LOCAL_CWD → cwd. */
export function resolveRepoPath(rootRepoPath?: string): string {
  return rootRepoPath ?? process.env.ORCH_PLAN_LOCAL_CWD ?? process.cwd();
}

/**
 * Build a resolver that prefers mcp-context-manager structural facts (when a URL
 * is set and its index is non-empty) and falls back to the local repo file-scan.
 */
export function buildCodebaseResolver(opts: {
  repoPath: string;
  mcpUrl?: string;
}): () => Promise<CodebaseContext | undefined> {
  return async () => (await resolveCodebaseWithSource(opts))?.context;
}

/** Source of a resolved CodebaseContext — which layer produced it. */
export type CodebaseSource = "mcp-context-manager" | "repo-scan";

/**
 * Same MCP-first → file-scan logic, but also reports WHICH layer produced the
 * context (the KB sync flow records the source). Returns undefined when neither
 * yields anything usable.
 */
export async function resolveCodebaseWithSource(opts: {
  repoPath: string;
  mcpUrl?: string;
}): Promise<{ context: CodebaseContext; source: CodebaseSource } | undefined> {
  if (opts.mcpUrl) {
    const viaMcp = await createMcpContextResolver({
      baseUrl: opts.mcpUrl,
      repoPath: opts.repoPath,
    })();
    if (viaMcp) return { context: viaMcp, source: "mcp-context-manager" };
  }
  const viaScan = await createRepoSummaryResolver({ cwd: opts.repoPath })();
  if (viaScan) return { context: viaScan, source: "repo-scan" };
  return undefined;
}
