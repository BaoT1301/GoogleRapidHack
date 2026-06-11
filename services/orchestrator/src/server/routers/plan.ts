import { z } from "zod";
import { authedProcedure, createTRPCRouter } from "../init";
import { connectDB } from "../../db/client";
import { getSettingsGateway } from "../data/settings-gateway";
import { resolvePersona } from "../templates/resolve-template";
import {
  CloudArchitectProvider,
  LocalCliArchitectProvider,
  resolveCodebaseContext,
  resolvePlanProviderName,
  selectPlanProvider,
} from "../plan";
import {
  buildCodebaseResolver,
  resolveMcpUrl,
  resolveRepoPath,
} from "../plan/build-codebase-resolver";
import { queryCodebaseKb } from "../plan/query-codebase";
import { hybridMatches } from "../plan/semantic-query";
import { getEmbedder } from "../plan/embedder";
import { ensureFreshProjectKb } from "../plan/sync-project-kb";
import { getKbGateway } from "../data/kb-gateway";
import { AgenticArchitectProvider } from "../plan/agentic-architect-provider";
import type { PlanProvider } from "../plan/types";

/**
 * Plan forwarder + provider seam (PLAN-8a).
 *
 * `generate` selects a `PlanProvider` — **Cloud** (the hosted `services/llm`
 * Gemini Architect, default) or **Local** (`kiro-cli` running `product_architect`
 * on the host). Both return the canonical top-level `ContextRequest | GraphSpec`
 * body (see `.claude/docs/core/api-contracts/architect-plan-api.md`); the Cloud
 * path is byte-for-byte unchanged.
 *
 * Provider precedence: explicit `input.provider` → `ORCH_PLAN_PROVIDER` env →
 * Cloud. Track 4/5 persist the Settings toggle and pass `provider`.
 *
 * `health` probes the Cloud Architect (unchanged §7 shape). Track 3 (PLAN-8b)
 * adds dual-provider/Local status.
 */
const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

/**
 * Optional codebase context (PLAN-1, §2 + §8a). Accepted on the input for
 * forward-compatibility, but the orchestrator **server-resolves + sanitizes** it
 * (bounded, secret-free) before forwarding — a raw client blob is never trusted.
 * `.passthrough()` keeps it tolerant of extra keys; `.optional()` keeps it additive.
 */
const CodebaseContextSchema = z
  .object({
    repoSummary: z.string().optional(),
    files: z.array(z.string()).optional(),
    symbols: z.array(z.string()).optional(),
    stats: z
      .object({
        fileCount: z.number().optional(),
        symbolCount: z.number().optional(),
        languages: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .optional();

export const planRouter = createTRPCRouter({
  generate: authedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        messages: z.array(MessageSchema).default([]),
        approved: z.boolean().default(false),
        persona: z.string().min(1).optional(),
        provider: z.enum(["cloud", "local"]).optional(),
        codebaseContext: CodebaseContextSchema,
        // PLAN-1 feed (P2): the active graph's repo path so the server-side
        // resolver can summarize the real codebase. Optional + additive — falls
        // back to ORCH_PLAN_LOCAL_CWD / cwd (same convention as the local planner).
        rootRepoPath: z.string().optional(),
        // P3: when set, the planner loads the project's SYNCED KB from the DB
        // (kb.sync) instead of resolving live — the end-to-end "context in the DB
        // flows into the plan" path. Additive + owner-scoped.
        projectId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const {
        provider: requested,
        codebaseContext: hint,
        rootRepoPath,
        projectId,
        ...rest
      } = input;

      // P3: prefer the project's SYNCED KB from the DB when a projectId is given —
      // this is the "throw a repo → KB persisted → plan reasons from it" loop.
      // Best-effort + owner-scoped; falls through to live resolution if absent.
      let storedKb:
        | {
            repoSummary?: string;
            files?: string[];
            symbols?: string[];
            symbolVectors?: number[][];
            stats?: { fileCount?: number; symbolCount?: number; languages?: string[] };
          }
        | undefined;
      if (projectId) {
        try {
          // Auto-sync: refresh the KB if the repo changed since the last sync
          // (e.g. after an agent run modified files). Best-effort + gated
          // (ORCH_KB_AUTOSYNC=false to disable); never blocks planning.
          await ensureFreshProjectKb(ctx.userId, projectId, ctx);
          // Load the synced KB through the gateway (direct Mongo by default; the
          // cloud BFF in BFF mode) — so KB-aware planning works in BFF mode too.
          const kb = await getKbGateway(ctx).get(ctx.userId, projectId);
          if (kb) {
            storedKb = {
              repoSummary: kb.repoSummary,
              files: kb.files,
              symbols: kb.symbols,
              symbolVectors: kb.symbolVectors,
              stats: kb.stats,
            };
          }
        } catch {
          storedKb = undefined;
        }
      }

      // Server-resolve + sanitize (bounded, secret-free) — never forward a raw
      // client blob (§8a). Precedence: synced KB (DB) → live resolver (P2/P3
      // structural facts) → client hint. Everything passes through
      // sanitizeCodebaseContext, so when nothing usable survives the field is
      // omitted and the Cloud path stays byte-for-byte backward compatible.
      // Disable live resolution with ORCH_PLAN_CODEBASE_CONTEXT=false.
      const codebaseEnabled = process.env.ORCH_PLAN_CODEBASE_CONTEXT !== "false";
      const resolver = buildCodebaseResolver({
        repoPath: resolveRepoPath(rootRepoPath),
        mcpUrl: resolveMcpUrl(),
      });
      // P4: when we have a synced KB, FOCUS it on the task (query_codebase ranks
      // the repo's symbols/files by relevance to the prompt) so a big repo's plan
      // request carries the parts that matter, not an arbitrary slice. Falls back
      // to the whole KB when focusing yields nothing.
      const focusedKb = storedKb
        ? queryCodebaseKb(storedKb, input.prompt) ?? storedKb
        : undefined;
      const codebaseContext = focusedKb
        ? await resolveCodebaseContext(focusedKb)
        : await resolveCodebaseContext(hint, codebaseEnabled ? { resolver } : {});

      // TPL-4 (§8c): when a persona is pinned and the OWNER has forked it,
      // thread the resolved workspace-fork content into the plan request
      // additively. Best-effort + workspace-only → Cloud path byte-identical
      // for owners without a fork (or on any DB error).
      let resolvedPersona:
        | { id?: string; content: string; version?: string }
        | undefined;
      if (rest.persona) {
        try {
          // Non-BFF only: ensure the local Mongo connection for the TemplateModel
          // read below. In BFF mode resolvePersona short-circuits to null (serving
          // personas over the BFF service path is a follow-up), so skip connectDB
          // entirely — calling it would stall ~10s against a Mongo that's off.
          if (!process.env.BFF_URL) await connectDB();
          const r = await resolvePersona(ctx.userId, rest.persona);
          if (r && r.source === "workspace") {
            resolvedPersona = { id: r.id, content: r.content, version: r.version };
          }
        } catch {
          resolvedPersona = undefined;
        }
      }

      const planInput = {
        ...rest,
        ...(codebaseContext ? { codebaseContext } : {}),
        ...(resolvedPersona ? { resolvedPersona } : {}),
      };

      // P5: resolve the provider server-authoritatively. When the call does not
      // pin one, honor the user's persisted Settings toggle (plannerProvider, DB)
      // → env → Cloud default. Best-effort: a settings read failure falls through.
      let providerSetting: "cloud" | "local" | undefined;
      if (!requested) {
        try {
          // Read through the SettingsGateway so the planner-provider toggle is honored
          // in BFF mode too (resolved from the cloud where the UI persists it) — a
          // direct local-Mongo read would throw and silently ignore the user's choice.
          const settings = await getSettingsGateway(ctx).get(ctx.userId);
          providerSetting = settings.plannerProvider;
        } catch {
          providerSetting = undefined;
        }
      }
      const providerName = resolvePlanProviderName(requested, providerSetting);

      // Track A: when the cloud planner is selected AND this project has a synced
      // KB, use the AGENTIC conductor — it drives services/llm /api/v1/generate
      // turn-by-turn and answers the model's query_codebase calls LOCALLY from the
      // KB (the cloud planner reasons agentically; the KB never leaves here).
      // Disable with ORCH_PLAN_AGENTIC=false → falls back to the one-shot cloud path.
      const agenticEnabled = process.env.ORCH_PLAN_AGENTIC !== "false";
      const hasKb = !!storedKb && ((storedKb.files?.length ?? 0) > 0 || (storedKb.symbols?.length ?? 0) > 0);
      let provider: PlanProvider;
      if (providerName === "cloud" && agenticEnabled && hasKb) {
        const kb = storedKb!;
        const embedder = getEmbedder();
        provider = new AgenticArchitectProvider({
          queryCodebase: async (query, limit) =>
            hybridMatches(
              { symbols: kb.symbols, files: kb.files, symbolVectors: kb.symbolVectors },
              query,
              { embedder, limit },
            ),
        });
      } else {
        provider = selectPlanProvider(providerName);
      }
      return provider.generate(planInput);
    }),

  /**
   * Liveness probe for the Architect API (Track 5 Settings/health). Returns a
   * non-secret config + reachability snapshot. The service token value is never
   * returned — only a present/absent flag (Zero-Secret Leakage).
   */
  health: authedProcedure.query(async () => {
    return new CloudArchitectProvider().health();
  }),

  /**
   * Dual-provider readiness (PLAN-8b, Track 3) for the Settings provider toggle.
   * Reports BOTH the Cloud Architect (reachability) and the Local kiro-cli planner
   * (`whoami`-derived signed-in / not-signed-in / not-installed). Additive — does
   * not change `plan.health`. Never echoes a secret/key value (AD-8).
   * Contract: `.claude/docs/core/api-contracts/architect-plan-api.md` §7.
   */
  providerStatus: authedProcedure.query(async () => {
    const [cloud, local] = await Promise.all([
      new CloudArchitectProvider().health(),
      new LocalCliArchitectProvider().health(),
    ]);
    return { cloud, local };
  }),
});
