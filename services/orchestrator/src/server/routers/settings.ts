import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "../init";
import {
  PLANNER_PROVIDERS,
  MERGE_STRATEGIES,
  CANVAS_BACKGROUND_KINDS,
  MCP_STARTUP_POLICIES,
} from "../../db/models/settings.model";
import { SUPPORTED_CLIS } from "../../db/models/graph.model";
import { getSettingsGateway } from "../data/settings-gateway";
import { checkCliCapability } from "../runtime/cli-capabilities";

/**
 * Persisted per-user workspace settings (CLI-4 + planner toggle + per-CLI tools +
 * canvas theming).
 *   - `settings.get`    → current settings (defaults when none saved), including
 *     a normalized `allowedToolsByCli` map for every catalog CLI + canvas theme.
 *   - `settings.update` → upsert. Tool sets are normalized per CLI (unknown
 *     tokens dropped; never trust-all; never empty).
 *
 * The persisted `plannerProvider` is the Settings toggle's source of truth; the UI
 * reads it here and passes it to `plan.generate({ provider })`. The flat
 * `allowedTools` array remains kiro's source of truth for execution
 * (`resolveAllowedTools` reads it); the kiro entry in `allowedToolsByCli` is always
 * kept mirrored to it. Non-kiro selections are persisted intent only — not yet
 * wired into execution. `canvasThemePackId`/`canvasConfig` drive the canvas theme.
 *
 * P0-full: persistence AND per-CLI normalization route through the settings gateway
 * (Mongo by default; the cloud BFF when BFF_URL is set). Normalization lives in the
 * gateway so whoever owns Mongo is the authority. `authedProcedure` (not
 * `dbProcedure`) — the Mongo gateway self-connects; the BFF gateway needs no local DB.
 */
export const settingsRouter = createTRPCRouter({
  get: authedProcedure.query(async ({ ctx }) => {
    return getSettingsGateway(ctx).get(ctx.userId);
  }),

  update: authedProcedure
    .input(
      z.object({
        allowedTools: z.array(z.string()).optional(),
        allowedToolsByCli: z.record(z.string(), z.array(z.string())).optional(),
        plannerProvider: z.enum(PLANNER_PROVIDERS).optional(),
        mergeStrategy: z.enum(MERGE_STRATEGIES).optional(),
        canvasThemePackId: z.string().min(1).optional(),
        canvasConfig: z
          .object({
            motionEnabled: z.boolean().optional(),
            backgroundKind: z.enum(CANVAS_BACKGROUND_KINDS).optional(),
          })
          .optional(),
        // MODEL-1: per-node-type default model map (node kind → model id). Kept
        // permissive at the boundary; the gateway normalizes (unknown kinds +
        // invalid model ids dropped), mirroring the allowedToolsByCli pattern.
        defaultModelByNodeType: z.record(z.string(), z.string()).optional(),
        // MODEL-1: fixer defaults applied to spawned fixer nodes.
        fixerConfig: z
          .object({
            cli: z.enum(SUPPORTED_CLIS).optional(),
            model: z.string().optional(),
            persona: z.string().optional(),
          })
          .optional(),
        // MCP-RESILIENCE: execute-node MCP startup policy.
        mcpStartupPolicy: z.enum(MCP_STARTUP_POLICIES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Local planner requires a working kiro-cli ON THIS HOST. This is a host-local
      // probe (the cloud BFF can't see the user's machine), so it stays in the
      // orchestrator — before persistence — and never lets the toggle flip to "local"
      // when kiro-cli is unavailable. Persistence still routes through the gateway.
      if (input.plannerProvider === "local") {
        const kiroCap = await checkCliCapability("kiro");
        if (!kiroCap.available) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Local planner (kiro-cli) is not available: ${kiroCap.note ?? "not configured"}.`,
          });
        }
      }
      return getSettingsGateway(ctx).update(ctx.userId, input);
    }),
});
