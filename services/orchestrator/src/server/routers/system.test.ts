import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import type { CliCapabilities } from "../runtime/cli-capabilities";

// Mock the runtime capability probe so the router test is deterministic (it must
// not depend on which CLIs happen to be installed on the test host).
const getAll = vi.fn<() => Promise<CliCapabilities>>();
vi.mock("../runtime/cli-capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime/cli-capabilities")>();
  return {
    ...actual,
    getAllCliCapabilities: () => getAll(),
  };
});

const createCaller = createCallerFactory(appRouter);
const me = createCaller({ userId: "u_sys" });

function caps(overrides: Partial<CliCapabilities> = {}): CliCapabilities {
  const base: CliCapabilities = {
    fake: { available: true, command: "node", version: "v22.16.0", verified: true, note: "Deterministic local fake agent is available" },
    codex: { available: false, command: "codex", note: "Codex CLI not found", suggestedFix: "Install Codex CLI or switch this node to fake" },
    kiro: { available: true, command: "kiro-cli", authMode: "host-login", requiresApiKey: false, experimental: true, verified: true, note: "Signed in via host login (kiro-cli login). KIRO_API_KEY is an optional fallback." },
    gemini: { available: false, command: "gemini", experimental: true, note: "Gemini CLI not found", suggestedFix: "Install Gemini CLI or switch this node to fake" },
    claude: { available: false, command: "claude", note: "Claude CLI not found", suggestedFix: "Install Claude CLI or switch this node to fake" },
  };
  return { ...base, ...overrides };
}

describe("system.capabilities (CLI-5 — RUN-8 unblock)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requires authentication", async () => {
    const anon = createCaller({ userId: null });
    await expect(anon.system.capabilities()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns one entry per supported CLI in canonical order with authMode/available", async () => {
    getAll.mockResolvedValue(caps());
    const list = await me.system.capabilities();

    expect(list.map((c) => c.cli)).toEqual(["fake", "codex", "kiro", "gemini", "claude"]);

    const kiro = list.find((c) => c.cli === "kiro")!;
    expect(kiro).toMatchObject({ available: true, authMode: "host-login" });

    const codex = list.find((c) => c.cli === "codex")!;
    expect(codex).toMatchObject({ available: false, suggestedFix: expect.stringContaining("Install") });
  });

  it("surfaces the not-signed-in kiro auth state with a fix hint", async () => {
    getAll.mockResolvedValue(
      caps({
        kiro: {
          available: false,
          command: "kiro-cli",
          authMode: "unauthenticated",
          requiresApiKey: false,
          experimental: true,
          verified: false,
          note: "kiro-cli is installed but not signed in.",
          suggestedFix: "Run `kiro-cli login`, set KIRO_API_KEY, or switch this node to fake",
        },
      }),
    );
    const list = await me.system.capabilities();
    const kiro = list.find((c) => c.cli === "kiro")!;
    expect(kiro).toMatchObject({
      available: false,
      authMode: "unauthenticated",
      suggestedFix: expect.stringContaining("kiro-cli login"),
    });
  });

  it("NEVER leaks a key value or host executable path (AD-8 allow-list projection)", async () => {
    process.env.KIRO_API_KEY = "sk-SECRET-DO-NOT-LEAK";
    getAll.mockResolvedValue(
      caps({
        kiro: {
          available: true,
          command: "kiro-cli",
          authMode: "api-key",
          requiresApiKey: false,
          note: "Using KIRO_API_KEY (fallback). The recommended path is `kiro-cli login`.",
          // Fields that must be stripped by the projection:
          executablePath: "/Users/secret/.local/bin/kiro-cli",
          configuredModel: "internal-model-name",
          useCd: true,
        },
      }),
    );

    const list = await me.system.capabilities();
    const json = JSON.stringify(list);

    expect(json).not.toContain("sk-SECRET-DO-NOT-LEAK");
    expect(json).not.toContain("/Users/secret/.local/bin/kiro-cli");
    expect(json).not.toContain("executablePath");
    expect(json).not.toContain("configuredModel");
    expect(json).not.toContain("useCd");

    const kiro = list.find((c) => c.cli === "kiro")!;
    expect(kiro.authMode).toBe("api-key");
    expect(Object.keys(kiro)).not.toContain("executablePath");

    delete process.env.KIRO_API_KEY;
  });
});

describe("system.kiroTools (CLI-4 — allowed-tools editor surface)", () => {
  it("exposes the canonical tool list with read/write classification + read-only default", async () => {
    const res = await me.system.kiroTools();
    const byName = Object.fromEntries(res.tools.map((t) => [t.name, t.kind]));
    expect(byName.fs_read).toBe("read");
    expect(byName.fs_write).toBe("write");
    expect(res.defaultAllowed).toEqual(["fs_read"]);
    expect(res.readOnly).toContain("fs_read");
    // The default never enables a write tool.
    expect(res.defaultAllowed).not.toContain("fs_write");
  });

  it("requires authentication", async () => {
    const anon = createCaller({ userId: null });
    await expect(anon.system.kiroTools()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("system.cliTools (per-CLI allowed-tools catalogs)", () => {
  it("returns per-CLI catalogs in order with a wired flag (only kiro wired)", async () => {
    const cats = await me.system.cliTools();
    expect(cats.map((c) => c.cli)).toEqual(["kiro", "codex", "gemini", "claude"]);

    const kiro = cats.find((c) => c.cli === "kiro")!;
    expect(kiro.wired).toBe(true);
    expect(kiro.tools.map((t) => t.name)).toContain("fs_read");
    expect(kiro.defaultAllowed).toEqual(["fs_read"]);

    const codex = cats.find((c) => c.cli === "codex")!;
    expect(codex.wired).toBe(false);
    expect(codex.note).toMatch(/Informational/i);
    // Default never enables a write/execute tool.
    expect(codex.defaultAllowed).not.toContain("edit_files");
    expect(codex.defaultAllowed).not.toContain("run_commands");
  });

  it("requires authentication", async () => {
    const anon = createCaller({ userId: null });
    await expect(anon.system.cliTools()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
