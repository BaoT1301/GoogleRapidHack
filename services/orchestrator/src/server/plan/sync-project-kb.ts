/**
 * Project KB sync — the single place that extracts a repo's structural snapshot,
 * embeds it, and upserts it to the DB per ownerId+projectId. Used by both the
 * `kb.sync` mutation (explicit) and `ensureFreshProjectKb` (auto-sync at plan time).
 */
import { TRPCError } from "@trpc/server";
import { sanitizeCodebaseContext, CODEBASE_STORAGE_LIMITS } from "./codebase-context";
import { resolveCodebaseWithSource, resolveMcpUrl, resolveRepoPath } from "./build-codebase-resolver";
import { ensureManagedMcp } from "./managed-mcp";
import { getEmbedder } from "./embedder";
import { embedWithCache } from "./embed-cache";
import { computeRepoSignature } from "./repo-signature";
import { getProjectGateway } from "../data/project-gateway";
import { getKbGateway } from "../data/kb-gateway";
import type { KbSource } from "../../db/models/codebase-kb.model";

/** Optional request context — its token selects the BFF vs Mongo gateway. */
type GatewayCtx = { token?: string | null };

/** Max symbols to embed at sync (bounds doc size + embedding cost). */
const EMBED_CAP = 500;

const EMBED_MODEL = "text-embedding-004";

export interface SyncResult {
  projectId: string;
  source: string;
  fileCount: number;
  symbolCount: number;
  /** How many symbols carry an embedding vector. */
  vectorCount: number;
  /** Symbols freshly embedded this sync (cache misses). */
  embedded: number;
  /** Symbols that reused a cached vector (unchanged since last sync). */
  reused: number;
  indexedAt: Date;
}

/**
 * Extract + persist a project's codebase KB. Returns null when the project does
 * not exist (caller maps to 404); throws BAD_REQUEST when the repo is unreadable.
 */
export async function syncProjectKb(opts: {
  ownerId: string;
  projectId: string;
  rootRepoPath?: string;
  /** Request ctx (token) — selects the BFF gateway in BFF mode; Mongo otherwise. */
  ctx?: GatewayCtx;
}): Promise<SyncResult | null> {
  const ctx = opts.ctx ?? {};
  const project = await getProjectGateway(ctx).get(opts.ownerId, opts.projectId);
  if (!project) return null;

  const repoPath = resolveRepoPath(opts.rootRepoPath ?? project.rootRepoPath);
  // Prefer an explicit MCP_CONTEXT_URL; otherwise auto-spawn a managed mcp for this repo
  // (rich context: signatures + edges). Best-effort — falls back to repo-scan when mcp
  // isn't available / not ready yet.
  const mcpUrl = resolveMcpUrl() ?? (await ensureManagedMcp(repoPath));
  const resolved = await resolveCodebaseWithSource({ repoPath, mcpUrl });
  if (!resolved) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Could not extract codebase context from ${repoPath} (empty or unreadable repo).`,
    });
  }

  const safe = sanitizeCodebaseContext(resolved.context, CODEBASE_STORAGE_LIMITS);
  const symbols = safe?.symbols ?? [];
  const toEmbed = symbols.slice(0, EMBED_CAP);

  // Track D + incremental: embed the first EMBED_CAP symbols, REUSING vectors from the
  // previous KB for symbols whose text is unchanged (the prior doc is the cache) so a
  // small change doesn't re-embed all ~500. Gated + best-effort + batched.
  let symbolVectors: number[][] | undefined;
  let embedModel: string | undefined;
  let embedded = 0;
  let reused = 0;
  const embedder = getEmbedder();
  if (embedder && toEmbed.length > 0) {
    try {
      const prev = await getKbGateway(ctx).get(opts.ownerId, opts.projectId);
      const result = await embedWithCache({
        symbols: toEmbed,
        prevSymbols: prev?.symbols,
        prevVectors: prev?.symbolVectors,
        prevModel: prev?.embedModel,
        model: EMBED_MODEL,
        embedder,
      });
      symbolVectors = result.vectors;
      embedModel = EMBED_MODEL;
      embedded = result.embedded;
      reused = result.reused;
    } catch {
      symbolVectors = undefined;
    }
  }

  const repoSignature = await computeRepoSignature(repoPath);
  const indexedAt = new Date();
  // Persist through the gateway: direct Mongo by default, the cloud BFF in BFF mode
  // (the extraction above always runs LOCALLY — only the persistence hops).
  const doc = await getKbGateway(ctx).upsert(opts.ownerId, opts.projectId, {
    source: resolved.source as KbSource,
    repoSummary: safe?.repoSummary,
    files: safe?.files ?? [],
    symbols,
    symbolVectors,
    embedModel,
    edges: safe?.edges,
    stats: safe?.stats,
    repoSignature,
    indexedAt,
  });

  return {
    projectId: opts.projectId,
    source: resolved.source,
    fileCount: doc.stats?.fileCount ?? doc.files?.length ?? 0,
    symbolCount: doc.symbols?.length ?? 0,
    vectorCount: symbolVectors?.length ?? 0,
    embedded,
    reused,
    indexedAt,
  };
}

/**
 * Auto-sync (best-effort): re-sync the project's KB if the repo changed since the
 * last sync (cheap git-signature compare) or was never synced. Gated by
 * ORCH_KB_AUTOSYNC (default on); never throws. Called before a plan loads the KB
 * so plans always reason from fresh context (e.g. after an agent run changed files).
 */
export async function ensureFreshProjectKb(
  ownerId: string,
  projectId: string,
  ctx: GatewayCtx = {},
): Promise<{ resynced: boolean }> {
  if (process.env.ORCH_KB_AUTOSYNC === "false") return { resynced: false };
  try {
    const project = await getProjectGateway(ctx).get(ownerId, projectId);
    if (!project) return { resynced: false };

    const repoPath = resolveRepoPath(project.rootRepoPath);
    const meta = await getKbGateway(ctx).getMeta(ownerId, projectId);
    const sig = await computeRepoSignature(repoPath);

    // Resync when: never synced, OR we can tell the repo changed (sig differs).
    // When sig is "" (non-git/unknown) and a KB exists, don't thrash.
    if (!meta || (sig !== "" && meta.repoSignature !== sig)) {
      await syncProjectKb({ ownerId, projectId, ctx });
      return { resynced: true };
    }
  } catch {
    // best-effort: never block planning on a sync hiccup
  }
  return { resynced: false };
}

/**
 * Auto-sync the KB for whichever project maps to `rootRepoPath` (matched by resolved
 * path among the owner's projects). Used after a run finishes so the cloud KB reflects
 * the code the run produced — without waiting for the next plan. Best-effort: never
 * throws; returns { resynced: false } when no project matches, autosync is off, or the
 * captured token has lapsed (BFF mode). In Mongo mode the token is irrelevant.
 */
export async function ensureFreshProjectKbForRepo(
  ownerId: string,
  rootRepoPath: string,
  ctx: GatewayCtx = {},
): Promise<{ resynced: boolean }> {
  if (process.env.ORCH_KB_AUTOSYNC === "false") return { resynced: false };
  try {
    const target = resolveRepoPath(rootRepoPath);
    const projects = await getProjectGateway(ctx).list(ownerId);
    const match = projects.find(
      (p) => p.rootRepoPath && resolveRepoPath(p.rootRepoPath) === target,
    );
    if (!match) return { resynced: false };
    return await ensureFreshProjectKb(ownerId, match.projectId, ctx);
  } catch {
    // best-effort: a stale token / unreadable repo never breaks the caller
    return { resynced: false };
  }
}
