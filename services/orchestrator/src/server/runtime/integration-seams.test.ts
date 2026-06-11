import { describe, expect, it } from "vitest";
import { NODE_RUN_STATUSES } from "./types";
import { resolveKiroAuthMode } from "./cli-capabilities";
import { NODE_STATE_MAP } from "@/lib/run-events";
import { STATUS_COLORS } from "@/lib/status";
import { describeCliAuth } from "@/lib/cli-auth";

// Integration Review (read-only): assert the cross-track seams line up so the
// six feature tracks compose into one functional run with no contract drift.
describe("Sprint 1 integration seams", () => {
  it("every UI node status (run-events) is in the canonical backend enum (RUN-2 ↔ RUN-8)", () => {
    for (const status of Object.values(NODE_STATE_MAP)) {
      expect(NODE_RUN_STATUSES as readonly string[]).toContain(status);
    }
  });

  it("every UI node status has a colour (no uncoloured live state)", () => {
    for (const status of Object.values(NODE_STATE_MAP)) {
      expect(STATUS_COLORS[status]).toBeDefined();
    }
  });

  it("backend authMode values (CLI-1) all resolve to a defined UI label (CLI-1 ↔ RUN-8)", () => {
    const cases = [
      { installed: true, hostLoggedIn: true, apiKeyPresent: false },
      { installed: true, hostLoggedIn: false, apiKeyPresent: true },
      { installed: true, hostLoggedIn: false, apiKeyPresent: false },
    ];
    for (const c of cases) {
      const { authMode } = resolveKiroAuthMode(c);
      const info = describeCliAuth("kiro", authMode);
      // Resolved (not the unknown fallback): a real onboarding label + tone.
      expect(["ok", "warn", "error"]).toContain(info.tone);
      expect(info.label).toMatch(/^Kiro: /);
    }
  });
});
