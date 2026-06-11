import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "../init";
import { getKbGateway } from "../data/kb-gateway";
import { getProjectGateway } from "../data/project-gateway";
import { hybridMatches } from "../plan/semantic-query";
import { getEmbedder, embeddingsEnabled } from "../plan/embedder";
import { syncProjectKb } from "../plan/sync-project-kb";
import { resolveRepoPath } from "../plan/build-codebase-resolver";
import { computeRepoSignature } from "../plan/repo-signature";
import { evaluateKbHealth } from "../plan/kb-validate";

/**
 * Codebase KB router (Cloud Infra P3 / D5).
 *
 * `sync` is the "throw a repo at it" entry point: it extracts a bounded,
 * secret-free structural snapshot of the project's repo (mcp-context-manager
 * structural facts when available, else a local file-scan) and persists it to the
 * DB per `ownerId + projectId`. `get` reads it back. The planner then loads this
 * stored KB (plan.generate `projectId`) so a plan reasons from the synced context,
 * and auto-resyncs it when the repo has changed (sync-project-kb.ts).
 *
 * Scoped by Clerk `ctx.userId` (through auth). The stored snapshot is sanitized
 * (size-capped, secret-redacted) BEFORE it touches the DB — only a structural
 * representation is persisted, never raw source or credentials (D5).
 */
export const kbRouter = createTRPCRouter({
  // Extract + persist the project's codebase KB. Returns a small summary.
  // P0-full: extraction is LOCAL (locality law); persistence routes through the KB
  // gateway (Mongo by default; the cloud BFF in BFF mode) via the ctx token.
  // authedProcedure (not dbProcedure): the gateway self-connects / needs no local DB.
  sync: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        // Optional override; otherwise the project's stored rootRepoPath (then env/cwd).
        rootRepoPath: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await syncProjectKb({
        ownerId: ctx.userId,
        projectId: input.projectId,
        rootRepoPath: input.rootRepoPath,
        ctx,
      });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "project not found" });
      return result;
    }),

  // query_codebase (P4): relevance-ranked retrieval over the stored KB. This is
  // the callable tool an agentic planner invokes ("show me the auth symbols").
  // Owner-scoped; returns the matching symbols/files (score > 0), bounded. The KB is
  // fetched through the gateway; the RANKING runs compute-local on the result.
  query: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const kb = await getKbGateway(ctx).get(ctx.userId, input.projectId);
      if (!kb) return { projectId: input.projectId, found: false, symbols: [], files: [] };
      // Hybrid lexical + semantic (Track D) when vectors + an embedder are
      // available; pure lexical otherwise (additive fallback).
      const matches = await hybridMatches(
        { symbols: kb.symbols, files: kb.files, symbolVectors: kb.symbolVectors },
        input.query,
        {
          embedder: getEmbedder(),
          limit: input.limit ?? 40,
          // MongoDB Atlas Vector Search for the semantic half (server-side ANN);
          // hybridMatches falls back to in-app cosine if the index isn't ready.
          vectorSearch: (queryVec, k) =>
            getKbGateway(ctx).vectorSearch(ctx.userId, input.projectId, queryVec, k),
        },
      );
      return { projectId: input.projectId, found: true, ...matches };
    }),

  // Readiness/health snapshot for the Project Readiness panel: is the repo a git tree,
  // is the KB synced (counts + source + age), is it stale vs the repo now, and a list
  // of human-readable warnings (the "validate the data is correct" surface). Read-only.
  status: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectGateway(ctx).get(ctx.userId, input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "project not found" });

      const repoPath = resolveRepoPath(project.rootRepoPath);
      const [kb, sig] = await Promise.all([
        getKbGateway(ctx).get(ctx.userId, input.projectId),
        computeRepoSignature(repoPath),
      ]);

      const isGitRepo = sig !== "";
      const synced = !!kb;
      const symbolCount = kb?.symbols?.length ?? 0;
      const fileCount = kb?.stats?.fileCount ?? kb?.files?.length ?? 0;
      // Count only REAL vectors (non-empty). A partial/failed embed stores [] aligned to
      // symbols[] for the cosine fallback; those must not inflate the reported coverage.
      const vectorCount = kb?.symbolVectors?.filter((v) => v.length > 0).length ?? 0;
      // Stale when never synced, or the repo signature moved since the last sync.
      const stale = !kb || (sig !== "" && kb.repoSignature !== sig);

      const health = evaluateKbHealth({
        source: kb?.source ?? "repo-scan",
        symbolCount,
        fileCount,
        vectorCount,
        embeddingsEnabled: embeddingsEnabled(),
        isGitRepo,
        stale,
        synced,
      });

      return {
        projectId: input.projectId,
        repoPath,
        repo: { isGitRepo },
        kb: {
          synced,
          source: kb?.source,
          fileCount,
          symbolCount,
          vectorCount,
          indexedAt: kb?.indexedAt ?? null,
          stale,
        },
        ok: health.ok,
        warnings: health.warnings,
      };
    }),

  // Read the stored KB for a project (null when never synced).
  get: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const kb = await getKbGateway(ctx).get(ctx.userId, input.projectId);
      if (!kb) return null;
      return {
        projectId: input.projectId,
        source: kb.source,
        repoSummary: kb.repoSummary,
        files: kb.files,
        symbols: kb.symbols,
        stats: kb.stats,
        indexedAt: kb.indexedAt,
      };
    }),
});
