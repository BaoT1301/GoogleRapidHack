import { CloudArchitectProvider } from "./cloud-architect-provider";
import {
  LocalCliArchitectProvider,
  type LocalProviderDeps,
} from "./local-cli-architect-provider";
import type { PlanProvider, PlanProviderName } from "./types";

export { CloudArchitectProvider } from "./cloud-architect-provider";
export { LocalCliArchitectProvider, PLANNER_READONLY_TOOLS } from "./local-cli-architect-provider";
export type { LocalProviderDeps, LocalHealth } from "./local-cli-architect-provider";
export * from "./types";
export * from "./schemas";
export * from "./codebase-context";

/**
 * Resolve the effective planner provider for a request. Precedence:
 *   1. explicit `requested` (a call that pins the provider, e.g. providerStatus probes)
 *   2. `userSetting` — the user's persisted Settings toggle (`plannerProvider`, DB)
 *   3. `ORCH_PLAN_PROVIDER` env (ops override / default-for-deployment)
 *   4. **Cloud** (the default — owner decision)
 *
 * P5: the persisted toggle is now resolved SERVER-side (step 2) so toggling the
 * planner in Settings actually steers `plan.generate` even when the client does
 * not thread `provider` through. Unknown values fall through to the safe default.
 */
export function resolvePlanProviderName(
  requested?: PlanProviderName,
  userSetting?: PlanProviderName,
): PlanProviderName {
  if (requested === "local" || requested === "cloud") return requested;
  if (userSetting === "local" || userSetting === "cloud") return userSetting;
  return process.env.ORCH_PLAN_PROVIDER === "local" ? "local" : "cloud";
}

/** Instantiate a provider by name (Local accepts injectable deps for testing). */
export function selectPlanProvider(
  name: PlanProviderName,
  localDeps?: LocalProviderDeps,
): PlanProvider {
  return name === "local"
    ? new LocalCliArchitectProvider(localDeps)
    : new CloudArchitectProvider();
}
