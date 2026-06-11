import type { KiroAuthMode } from "./cli-capabilities";

// SEC-2 redaction core (registry + patterns + redactSecrets) lives in @repo/data-core
// so the shared run gateway redacts at the persistence seam; re-exported here so the
// orchestrator's existing `@/server/runtime/secret-redaction` imports are unchanged.
export {
  registerSecret,
  redactSecrets,
  __resetSecretsForTest,
} from "@repo/data-core/runtime/secret-redaction";

/**
 * Subprocess key-env decision (owner choice C): prefer the inherited host login —
 * inject NOTHING. Only when not host-login (api-key/unauthenticated fallback) do we
 * merge the fallback key into the subprocess env. Pure → unit-testable.
 */
export function subprocessKeyEnv(
  authMode: KiroAuthMode | undefined,
  fallbackKey: string | undefined,
): Record<string, string> {
  if (!authMode || authMode === "host-login") return {};
  return fallbackKey ? { KIRO_API_KEY: fallbackKey } : {};
}
