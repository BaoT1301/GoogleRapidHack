import { getSettingsGateway } from "@/server/data/settings-gateway";
import { MERGE_STRATEGIES, type MergeStrategy } from "@/db/models/settings.model";

const DEFAULT_MERGE_STRATEGY: MergeStrategy = "base-fanin";

function isMergeStrategy(value: unknown): value is MergeStrategy {
  return typeof value === "string" && (MERGE_STRATEGIES as readonly string[]).includes(value);
}

/**
 * Resolve the owner's merge-back model for a run. Precedence:
 *   1. `ORCH_MERGE_STRATEGY` env (safety/test override),
 *   2. the owner's persisted `mergeStrategy` setting (the Settings UI toggle),
 *   3. the `base-fanin` default (Sprint 3 behaviour).
 *
 * Read through the SettingsGateway (not direct Mongo) so BFF mode resolves the
 * setting from the cloud — where the UI toggle actually persists it — instead of a
 * local Mongo that isn't running (which would silently fall back to base-fanin).
 * The gateway picks the BFF backend when `BFF_URL` + the user `token` are present
 * (pass `ctx` from the run start, while the token is still live), else direct Mongo.
 * Never throws — a settings lookup must not break a run.
 */
export async function resolveMergeStrategy(
  ownerId: string,
  ctx?: { token?: string | null },
): Promise<MergeStrategy> {
  const envOverride = process.env.ORCH_MERGE_STRATEGY;
  if (isMergeStrategy(envOverride)) return envOverride;

  try {
    const settings = await getSettingsGateway(ctx ?? {}).get(ownerId);
    return isMergeStrategy(settings.mergeStrategy)
      ? settings.mergeStrategy
      : DEFAULT_MERGE_STRATEGY;
  } catch {
    return DEFAULT_MERGE_STRATEGY;
  }
}
