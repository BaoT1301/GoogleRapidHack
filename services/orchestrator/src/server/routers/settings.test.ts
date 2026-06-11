import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { UserSettingsModel } from "../../db/models/settings.model";
import { resolveAllowedTools } from "../settings/allowed-tools";

// Local planner toggling probes the host kiro-cli; mock it so the integration test
// is host-independent (default: available). Individual tests override per-call.
vi.mock("../runtime/cli-capabilities", () => ({
  checkCliCapability: vi.fn(async () => ({ available: true, command: "kiro" })),
}));
import { checkCliCapability } from "../runtime/cli-capabilities";

// Integration test — requires local Mongo.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_settings";
const OTHER = "test_user_settings_other";
const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });

beforeAll(async () => {
  await connectDB();
  await UserSettingsModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

afterAll(async () => {
  await UserSettingsModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

describe("settings router (CLI-4 allowed-tools + planner toggle)", () => {
  it("get returns safe read-only defaults when none saved", async () => {
    const s = await me.settings.get();
    expect(s).toEqual({
      allowedTools: ["fs_read"],
      allowedToolsByCli: {
        kiro: ["fs_read"],
        codex: ["read_files"],
        gemini: ["read_files"],
        claude: ["read_files"],
      },
      plannerProvider: "cloud",
      mergeStrategy: "base-fanin",
      canvasThemePackId: null,
      canvasConfig: {},
      defaultModelByNodeType: {},
      fixerConfig: {},
      mcpStartupPolicy: "best-effort",
    });
  });

  it("update persists the merge strategy (base-fanin default → lineage) and round-trips", async () => {
    const s = await me.settings.update({ mergeStrategy: "lineage" });
    expect(s.mergeStrategy).toBe("lineage");
    const reread = await me.settings.get();
    expect(reread.mergeStrategy).toBe("lineage");
  });

  it("update persists allowedTools (writes opt-in) and the planner provider", async () => {
    const s = await me.settings.update({
      allowedTools: ["fs_read", "fs_write"],
      plannerProvider: "local",
    });
    expect(s.allowedTools).toEqual(["fs_read", "fs_write"]);
    expect(s.plannerProvider).toBe("local");

    // Round-trips through the DB.
    const reread = await me.settings.get();
    expect(reread.allowedTools).toEqual(["fs_read", "fs_write"]);
    expect(reread.plannerProvider).toBe("local");
  });

  it("rejects switching to the local planner when kiro-cli is unavailable", async () => {
    vi.mocked(checkCliCapability).mockResolvedValueOnce({
      available: false,
      command: "kiro",
      note: "not configured",
    });
    await expect(me.settings.update({ plannerProvider: "local" })).rejects.toThrow(
      /Local planner .*not available/i,
    );
  });

  it("update NORMALIZES — drops unknown tools and never accepts trust-all", async () => {
    const s = await me.settings.update({ allowedTools: ["fs_write", "read", "grep", "*"] });
    // 'read'/'grep'/'*' dropped; only known fs_write kept.
    expect(s.allowedTools).toEqual(["fs_write"]);
  });

  it("update with an empty allowed set falls back to the read-only default", async () => {
    const s = await me.settings.update({ allowedTools: [] });
    expect(s.allowedTools).toEqual(["fs_read"]);
  });

  it("persists the canvas theme pack id + config and round-trips", async () => {
    const s = await me.settings.update({
      canvasThemePackId: "pixel",
      canvasConfig: { motionEnabled: false, backgroundKind: "lines" },
    });
    expect(s.canvasThemePackId).toBe("pixel");
    expect(s.canvasConfig).toMatchObject({
      motionEnabled: false,
      backgroundKind: "lines",
    });

    const reread = await me.settings.get();
    expect(reread.canvasThemePackId).toBe("pixel");
    expect(reread.canvasConfig).toMatchObject({
      motionEnabled: false,
      backgroundKind: "lines",
    });
  });

  it("partial canvasConfig update preserves the other field", async () => {
    await me.settings.update({
      canvasConfig: { motionEnabled: true, backgroundKind: "dots" },
    });
    // Update only backgroundKind → motionEnabled must be preserved.
    const s = await me.settings.update({
      canvasConfig: { backgroundKind: "none" },
    });
    expect(s.canvasConfig).toMatchObject({
      motionEnabled: true,
      backgroundKind: "none",
    });
  });

  it("is owner-scoped — another user keeps their own defaults", async () => {
    await me.settings.update({ plannerProvider: "local" });
    const theirs = await other.settings.get();
    expect(theirs.plannerProvider).toBe("cloud");
  });

  it("persists per-CLI selections and mirrors kiro into the flat allowedTools", async () => {
    const s = await me.settings.update({
      allowedToolsByCli: {
        kiro: ["fs_read", "fs_write"],
        codex: ["read_files", "edit_files"],
      },
    });
    expect(s.allowedToolsByCli.kiro).toEqual(["fs_read", "fs_write"]);
    expect(s.allowedToolsByCli.codex).toEqual(["read_files", "edit_files"]);
    // kiro mirrored into the flat source of truth used by execution.
    expect(s.allowedTools).toEqual(["fs_read", "fs_write"]);

    const reread = await me.settings.get();
    expect(reread.allowedToolsByCli.codex).toEqual(["read_files", "edit_files"]);
    expect(reread.allowedTools).toEqual(["fs_read", "fs_write"]);
  });

  it("per-CLI update normalizes unknown tokens and preserves other CLIs", async () => {
    await me.settings.update({
      allowedToolsByCli: { codex: ["read_files", "edit_files"] },
    });
    // Update only gemini with junk → unknown dropped, falls back to default;
    // codex's earlier selection must be preserved.
    const s = await me.settings.update({
      allowedToolsByCli: { gemini: ["nonsense", "*", "all"] },
    });
    expect(s.allowedToolsByCli.gemini).toEqual(["read_files"]); // default fallback
    expect(s.allowedToolsByCli.codex).toEqual(["read_files", "edit_files"]); // preserved
  });

  it("legacy flat allowedTools update mirrors into allowedToolsByCli.kiro", async () => {
    const s = await me.settings.update({ allowedTools: ["fs_read", "fs_write"] });
    expect(s.allowedToolsByCli.kiro).toEqual(["fs_read", "fs_write"]);
    expect(s.allowedTools).toEqual(["fs_read", "fs_write"]);
  });

  it("resolveAllowedTools is unchanged for legacy docs lacking allowedToolsByCli", async () => {
    const LEGACY = "test_user_settings_legacy";
    await UserSettingsModel.deleteMany({ ownerId: LEGACY });
    // Simulate a pre-existing doc with only the flat field (no per-CLI map).
    await UserSettingsModel.create({ ownerId: LEGACY, allowedTools: ["fs_read", "fs_write"] });
    const resolved = await resolveAllowedTools(LEGACY);
    expect(resolved).toEqual(["fs_read", "fs_write"]);
    await UserSettingsModel.deleteMany({ ownerId: LEGACY });
  });

  it("persists defaultModelByNodeType and round-trips, dropping unknown kinds + invalid ids", async () => {
    const s = await me.settings.update({
      defaultModelByNodeType: {
        execute: "claude-sonnet-4",
        review: "gpt-4.1",
        bogus: "x",
        doc: "bad model id!",
      },
    });
    expect(s.defaultModelByNodeType).toEqual({
      execute: "claude-sonnet-4",
      review: "gpt-4.1",
    });
    const reread = await me.settings.get();
    expect(reread.defaultModelByNodeType).toEqual({
      execute: "claude-sonnet-4",
      review: "gpt-4.1",
    });
  });

  it("persists fixerConfig (cli + model + persona) and round-trips", async () => {
    const s = await me.settings.update({
      fixerConfig: { cli: "codex", model: "gpt-4.1", persona: "backend_engineer" },
    });
    expect(s.fixerConfig).toEqual({
      cli: "codex",
      model: "gpt-4.1",
      persona: "backend_engineer",
    });
    const reread = await me.settings.get();
    expect(reread.fixerConfig).toEqual({
      cli: "codex",
      model: "gpt-4.1",
      persona: "backend_engineer",
    });
  });

  it("persists mcpStartupPolicy (best-effort default → require) and round-trips", async () => {
    const s = await me.settings.update({ mcpStartupPolicy: "require" });
    expect(s.mcpStartupPolicy).toBe("require");
    const reread = await me.settings.get();
    expect(reread.mcpStartupPolicy).toBe("require");
  });
});
