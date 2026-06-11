import { describe, expect, it } from "vitest";
import {
  CLI_TOOL_CATALOG_ORDER,
  CLI_TOOL_CATALOGS,
  getCliToolCatalogs,
  isCatalogCli,
  normalizeToolsForCli,
} from "./cli-tool-catalogs";
import { KIRO_CANONICAL_TOOLS } from "./kiro-tools";

describe("cli-tool-catalogs", () => {
  it("orders catalogs kiro, codex, gemini, claude (no `fake`)", () => {
    expect(getCliToolCatalogs().map((c) => c.cli)).toEqual([
      "kiro",
      "codex",
      "gemini",
      "claude",
    ]);
    expect(CLI_TOOL_CATALOG_ORDER).not.toContain("fake");
  });

  it("marks only kiro as wired; others are informational", () => {
    expect(CLI_TOOL_CATALOGS.kiro.wired).toBe(true);
    expect(CLI_TOOL_CATALOGS.codex.wired).toBe(false);
    expect(CLI_TOOL_CATALOGS.gemini.wired).toBe(false);
    expect(CLI_TOOL_CATALOGS.claude.wired).toBe(false);
  });

  it("kiro catalog reuses the canonical kiro tool set (no drift)", () => {
    expect(CLI_TOOL_CATALOGS.kiro.tools.map((t) => t.name)).toEqual(
      KIRO_CANONICAL_TOOLS.map((t) => t.name),
    );
    expect(CLI_TOOL_CATALOGS.kiro.defaultAllowed).toEqual(["fs_read"]);
  });

  it("every catalog's default set is read-only", () => {
    for (const cat of getCliToolCatalogs()) {
      const writeOrExec = cat.tools
        .filter((t) => t.kind !== "read")
        .map((t) => t.name);
      for (const name of cat.defaultAllowed) {
        expect(writeOrExec).not.toContain(name);
      }
    }
  });

  it("normalizeToolsForCli(kiro) keeps canonical semantics (unknown/wildcard dropped)", () => {
    expect(normalizeToolsForCli("kiro", ["fs_write", "fs_read", "fs_read"])).toEqual([
      "fs_read",
      "fs_write",
    ]);
    expect(normalizeToolsForCli("kiro", ["*", "all", "read", "grep"])).toEqual(["fs_read"]);
    expect(normalizeToolsForCli("kiro", [])).toEqual(["fs_read"]);
  });

  it("normalizeToolsForCli(codex) keeps only known names, never empty, dedupes in catalog order", () => {
    expect(
      normalizeToolsForCli("codex", ["run_commands", "read_files", "read_files"]),
    ).toEqual(["read_files", "run_commands"]);
    expect(normalizeToolsForCli("codex", ["totally_made_up", "*"])).toEqual(["read_files"]);
    expect(normalizeToolsForCli("codex", undefined)).toEqual(["read_files"]);
  });

  it("normalizeToolsForCli for an unknown CLI returns []", () => {
    expect(normalizeToolsForCli("fake", ["read_files"])).toEqual([]);
    expect(isCatalogCli("fake")).toBe(false);
    expect(isCatalogCli("kiro")).toBe(true);
  });
});
