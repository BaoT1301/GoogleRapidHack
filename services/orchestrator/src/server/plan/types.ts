import type { PlanResult } from "./schemas";
import type { CodebaseContext } from "./codebase-context";

/** Which planner backend services a `plan.generate` call. */
export type PlanProviderName = "cloud" | "local";

/** Normalized planner request (mirrors the architect-plan-api.md §2 request). */
export interface PlanGenerateInput {
  prompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  approved: boolean;
  persona?: string;
  /**
   * Optional, **server-resolved** codebase facts baked into the plan request
   * (PLAN-1, §2 + §8a). Bounded + secret-free; absent-safe (Cloud path is
   * byte-for-byte backward compatible when undefined).
   */
  codebaseContext?: CodebaseContext;
  /**
   * Optional, **server-resolved** persona fork (TPL-4, §8c). The owner's
   * workspace fork markdown for the requested persona. Absent unless the owner
   * has actually forked the persona (Cloud path byte-identical when undefined).
   */
  resolvedPersona?: { id?: string; content: string; version?: string };
}

/** Cloud Architect health snapshot — the canonical `plan.health` shape (§7). */
export interface CloudHealth {
  configured: boolean;
  tokenPresent: boolean;
  apiUrl: string | null;
  reachable: boolean;
  status: "ok" | "unreachable" | "rate_limited" | "not_configured";
  model?: string;
  reason?: string;
}

/**
 * A planner backend. Implementations:
 *   - `CloudArchitectProvider` — the hosted Gemini Architect (`services/llm`), unchanged.
 *   - `LocalCliArchitectProvider` — `kiro-cli` running `product_architect` locally.
 *
 * `generate` returns the canonical top-level `ContextRequest | GraphSpec`.
 * `health` returns a provider-specific readiness snapshot (Track 3 enriches Local).
 */
export interface PlanProvider {
  readonly name: PlanProviderName;
  generate(input: PlanGenerateInput): Promise<PlanResult | unknown>;
  health(): Promise<unknown>;
}

/** Result of running the local planner CLI once (mirrors ProcessManager output). */
export interface PlannerProcessResult {
  exitCode: number | null;
  stdoutText: string;
  stderrText: string;
  cancelled: boolean;
}

/** Injectable spawn so the local provider is unit-testable without a real CLI. */
export type PlannerSpawn = (cmd: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<PlannerProcessResult>;
