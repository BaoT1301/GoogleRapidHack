import { getSettingsGateway } from "@/server/data/settings-gateway";
import { normalizeAllowedTools } from "../runtime/kiro-tools";

/**
 * Resolve the owner's persisted kiro allowed-tools (normalized + safe). Used by
 * the run path (execute-runner) to map the UI-configured set onto kiro
 * `--trust-tools` for EXECUTE nodes. Falls back to the read-only default when the
 * owner has no setting. Never throws — a settings lookup must not break a run.
 *
 * Reads through the SettingsGateway so BFF mode resolves from the cloud (where the
 * Settings UI persists) rather than a local Mongo that's off — which would throw
 * and silently drop the owner's configured tools. Pass `ctx` (with the live user
 * token) from an interactive caller so the BFF backend is selected in BFF mode.
 */
export async function resolveAllowedTools(
  ownerId: string,
  ctx?: { token?: string | null },
): Promise<string[]> {
  try {
    const settings = await getSettingsGateway(ctx ?? {}).get(ownerId);
    return normalizeAllowedTools(settings.allowedTools);
  } catch {
    return normalizeAllowedTools(undefined);
  }
}
