import { TRPCError } from "@trpc/server";
import type { CloudHealth, PlanGenerateInput, PlanProvider } from "./types";

/**
 * Cloud planner — the hosted Architect API (`services/llm`, real Vertex Gemini)
 * on GCP Cloud Run, holding the platform Gemini key. Forwards with the shared
 * `X-Service-Token`. **Behavior is identical to the pre-seam `plan` router** — the
 * upstream top-level body (`ContextRequest | GraphSpec`) is returned AS-IS (no
 * zod validation, no `{ data, meta }` envelope) so this path stays 100% backward
 * compatible. Contract: `.claude/docs/core/api-contracts/architect-plan-api.md`.
 */
export class CloudArchitectProvider implements PlanProvider {
  readonly name = "cloud" as const;

  private url(): string {
    const url = process.env.LLM_API_URL ?? process.env.LLM_PROXY_URL;
    if (!url) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "LLM_API_URL not configured",
      });
    }
    return url;
  }

  async generate(input: PlanGenerateInput): Promise<unknown> {
    const res = await fetch(`${this.url()}/api/v1/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": process.env.LLM_SERVICE_TOKEN ?? "",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      throw new TRPCError({
        code: res.status === 429 ? "TOO_MANY_REQUESTS" : "INTERNAL_SERVER_ERROR",
        message:
          res.status === 429
            ? "Architect API is rate-limited — please retry in a moment."
            : `LLM API error: ${res.status}`,
      });
    }
    // Return the upstream top-level body as-is (ContextRequest | GraphSpec).
    return (await res.json()) as unknown;
  }

  async health(): Promise<CloudHealth> {
    const apiUrl = process.env.LLM_API_URL ?? process.env.LLM_PROXY_URL ?? null;
    const tokenPresent = Boolean(process.env.LLM_SERVICE_TOKEN);
    if (!apiUrl) {
      return {
        configured: false,
        tokenPresent,
        apiUrl: null,
        reachable: false,
        status: "not_configured",
        reason: "LLM_API_URL not configured",
      };
    }
    try {
      const res = await fetch(`${apiUrl}/api/v1/health`, {
        method: "GET",
        headers: { "X-Service-Token": process.env.LLM_SERVICE_TOKEN ?? "" },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status === 429) {
        return {
          configured: true,
          tokenPresent,
          apiUrl,
          reachable: false,
          status: "rate_limited",
          reason: "Architect API is rate-limited.",
        };
      }
      if (!res.ok) {
        return {
          configured: true,
          tokenPresent,
          apiUrl,
          reachable: false,
          status: "unreachable",
          reason: `Health check failed: ${res.status}`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as { model?: unknown };
      return {
        configured: true,
        tokenPresent,
        apiUrl,
        reachable: true,
        status: "ok",
        model: typeof body.model === "string" ? body.model : undefined,
      };
    } catch {
      return {
        configured: true,
        tokenPresent,
        apiUrl,
        reachable: false,
        status: "unreachable",
        reason: "Could not reach the Architect API.",
      };
    }
  }
}
