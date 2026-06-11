/**
 * Client-safe mirror of the backend Kiro `authMode` contract
 * (`.claude/docs/core/api-contracts/runtime-run-sse-api.md` §7 + `server/runtime/cli-capabilities.ts`).
 * Type-only mirror so no server module enters the client bundle. The KEY VALUE is
 * never represented here — present/absent state only (AD-8 / Zero-Secret Leakage).
 */
export type CliAuthMode = "host-login" | "api-key" | "unauthenticated";

export interface CliAuthInfo {
  label: string;
  hint?: string;
  tone: "ok" | "warn" | "error";
}

/** Map a CLI + resolved authMode to an onboarding-friendly, actionable label. */
export function describeCliAuth(cli: string, authMode: CliAuthMode | undefined): CliAuthInfo {
  const name = cli === "kiro" ? "Kiro" : cli.charAt(0).toUpperCase() + cli.slice(1);
  switch (authMode) {
    case "host-login":
      return { label: `${name}: signed in (host login)`, tone: "ok" };
    case "api-key":
      return { label: `${name}: using API key (fallback)`, tone: "warn" };
    case "unauthenticated":
      if (cli === "claude") {
        return {
          label: `${name}: not signed in`,
          hint: "Run `claude auth login` or add ANTHROPIC_API_KEY",
          tone: "error",
        };
      }
      return {
        label: `${name}: not signed in`,
        hint: "Run `kiro-cli login` or add KIRO_API_KEY",
        tone: "error",
      };
    default:
      return { label: `${name}: auth state unknown`, hint: "CLI detection pending", tone: "warn" };
  }
}
