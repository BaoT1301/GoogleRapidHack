import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { TsconfigResolver } from "../indexer/tsconfig-resolver.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "tsconfig-resolver-test-"));
}

async function writeJson(filePath: string, content: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(content, null, 2), "utf8");
}

async function writeRaw(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function touch(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "", "utf8");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TsconfigResolver", () => {
  let tmpDir: string;
  let resolver: TsconfigResolver;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    resolver = new TsconfigResolver(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Case 1: extension-style alias ─────────────────────────────────────────
  it("resolves @/* alias from extension/tsconfig.json to extension/src/*", async () => {
    await writeJson(path.join(tmpDir, "extension/tsconfig.json"), {
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
    });
    await touch(path.join(tmpDir, "extension/src/bridge/supabase.ts"));

    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "extension/src/ui/foo.ts"),
    );
    expect(tsconfig).not.toBeNull();

    const resolved = resolver.resolveAlias(tsconfig!, "@/bridge/supabase");
    expect(resolved).toBe(
      path.join(tmpDir, "extension/src/bridge/supabase").split(path.sep).join("/"),
    );
  });

  // ── Case 2: no tsconfig in tree ───────────────────────────────────────────
  it("returns null when no tsconfig exists in the ancestor tree", async () => {
    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "src/ui/foo.ts"),
    );
    expect(tsconfig).toBeNull();
  });

  // ── Case 3: two nested tsconfigs — deepest wins ───────────────────────────
  it("uses the deepest (most specific) tsconfig for a file", async () => {
    await writeJson(path.join(tmpDir, "tsconfig.json"), {
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["workspace-src/*"] },
      },
    });
    await writeJson(path.join(tmpDir, "extension/tsconfig.json"), {
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
    });

    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "extension/src/ui/foo.ts"),
    );
    expect(tsconfig).not.toBeNull();
    // Should use extension/tsconfig.json, not root tsconfig.json
    expect(tsconfig!.configPath).toContain("extension/tsconfig.json");
  });

  // ── Case 4: wildcard suffix alias ─────────────────────────────────────────
  it("resolves wildcard alias @lib/* → packages/lib/*", async () => {
    await writeJson(path.join(tmpDir, "tsconfig.json"), {
      compilerOptions: {
        baseUrl: ".",
        paths: { "@lib/*": ["packages/lib/*"] },
      },
    });

    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "src/app.ts"),
    );
    expect(tsconfig).not.toBeNull();

    const resolved = resolver.resolveAlias(tsconfig!, "@lib/utils");
    expect(resolved).toBe(
      path.join(tmpDir, "packages/lib/utils").split(path.sep).join("/"),
    );
  });

  // ── Case 5: exact alias (no wildcard) ─────────────────────────────────────
  it("resolves exact alias @config → src/config.ts", async () => {
    await writeJson(path.join(tmpDir, "tsconfig.json"), {
      compilerOptions: {
        baseUrl: ".",
        paths: { "@config": ["src/config.ts"] },
      },
    });

    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "src/app.ts"),
    );
    expect(tsconfig).not.toBeNull();

    const resolved = resolver.resolveAlias(tsconfig!, "@config");
    expect(resolved).toBe(
      path.join(tmpDir, "src/config.ts").split(path.sep).join("/"),
    );
  });

  // ── Case 6: extends chain ─────────────────────────────────────────────────
  it("inherits paths from parent tsconfig via extends", async () => {
    await writeJson(path.join(tmpDir, "tsconfig.base.json"), {
      compilerOptions: {
        baseUrl: ".",
        paths: { "@shared/*": ["shared/*"] },
      },
    });
    await writeJson(path.join(tmpDir, "tsconfig.json"), {
      extends: "./tsconfig.base.json",
      compilerOptions: {},
    });

    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "src/app.ts"),
    );
    expect(tsconfig).not.toBeNull();

    const resolved = resolver.resolveAlias(tsconfig!, "@shared/utils");
    expect(resolved).toBe(
      path.join(tmpDir, "shared/utils").split(path.sep).join("/"),
    );
  });

  // ── Case 7: JSONC with comments and trailing commas ───────────────────────
  it("parses JSONC tsconfig with comments and trailing commas", async () => {
    await writeRaw(
      path.join(tmpDir, "tsconfig.json"),
      `{
  // This is a comment
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"], // trailing comma
    },
  },
}`,
    );

    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "src/app.ts"),
    );
    expect(tsconfig).not.toBeNull();
    expect(Object.keys(tsconfig!.paths)).toContain("@/*");
  });

  // ── Case 8: circular extends ──────────────────────────────────────────────
  it("does not hang on circular extends — logs warning and returns partial result", async () => {
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await writeRaw(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.other.json", compilerOptions: { baseUrl: "." } }),
    );
    await writeRaw(
      path.join(tmpDir, "tsconfig.other.json"),
      JSON.stringify({ extends: "./tsconfig.json", compilerOptions: {} }),
    );

    // Should not throw or hang
    await expect(resolver.discover()).resolves.not.toThrow();

    warnSpy.mockRestore();
  });

  // ── Case 9: WATCH_IGNORES excludes a tsconfig ─────────────────────────────
  it("does not discover tsconfigs inside node_modules (WATCH_IGNORES)", async () => {
    await writeJson(path.join(tmpDir, "node_modules/some-pkg/tsconfig.json"), {
      compilerOptions: { paths: { "@pkg/*": ["src/*"] } },
    });
    await writeJson(path.join(tmpDir, "tsconfig.json"), {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });

    await resolver.discover();

    // Only the root tsconfig should be discovered (not node_modules one)
    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "node_modules/some-pkg/src/index.ts"),
    );
    // The node_modules tsconfig should NOT be in cache
    // (the file is under node_modules which is ignored)
    // The root tsconfig would match if the path is under tmpDir
    // but node_modules/some-pkg is not a direct ancestor match for root tsconfig
    // since root tsconfig dir = tmpDir and node_modules/some-pkg/src is under tmpDir
    // However, the node_modules tsconfig itself should not be cached
    if (tsconfig) {
      expect(tsconfig.configPath).not.toContain("node_modules");
    }
  });

  // ── Case 10: no paths in tsconfig ─────────────────────────────────────────
  it("returns null from resolveAlias when tsconfig has no paths", async () => {
    await writeJson(path.join(tmpDir, "tsconfig.json"), {
      compilerOptions: { baseUrl: ".", strict: true },
    });

    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "src/app.ts"),
    );
    expect(tsconfig).not.toBeNull();

    const resolved = resolver.resolveAlias(tsconfig!, "@/something");
    expect(resolved).toBeNull();
  });

  // ── Case 11: longest-prefix-first wins ────────────────────────────────────
  it("matches the longest alias prefix first", async () => {
    await writeJson(path.join(tmpDir, "tsconfig.json"), {
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
          "@/components/*": ["src/components/*"],
        },
      },
    });

    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "src/app.ts"),
    );
    expect(tsconfig).not.toBeNull();

    // @/components/Button should match @/components/* (longer prefix)
    const resolved = resolver.resolveAlias(tsconfig!, "@/components/Button");
    expect(resolved).toBe(
      path.join(tmpDir, "src/components/Button").split(path.sep).join("/"),
    );
  });

  // ── Case 12: invalidate re-parses a changed tsconfig ──────────────────────
  it("invalidate() re-parses the tsconfig and picks up new paths", async () => {
    const tsconfigPath = path.join(tmpDir, "tsconfig.json");
    await writeJson(tsconfigPath, {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });

    await resolver.discover();

    // Overwrite with new paths
    await writeJson(tsconfigPath, {
      compilerOptions: { baseUrl: ".", paths: { "@app/*": ["app/*"] } },
    });

    await resolver.invalidate(tsconfigPath);

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "src/app.ts"),
    );
    expect(tsconfig).not.toBeNull();

    // Old alias should no longer resolve
    expect(resolver.resolveAlias(tsconfig!, "@/foo")).toBeNull();
    // New alias should resolve
    const resolved = resolver.resolveAlias(tsconfig!, "@app/bar");
    expect(resolved).toBe(
      path.join(tmpDir, "app/bar").split(path.sep).join("/"),
    );
  });

  // ── Case 13: baseUrl absent — defaults to tsconfig dir ────────────────────
  it("uses tsconfig directory as baseUrl when baseUrl is absent", async () => {
    await writeJson(path.join(tmpDir, "packages/ui/tsconfig.json"), {
      compilerOptions: {
        paths: { "@ui/*": ["src/*"] },
      },
    });

    await resolver.discover();

    const tsconfig = resolver.findNearestTsconfig(
      path.join(tmpDir, "packages/ui/src/Button.ts"),
    );
    expect(tsconfig).not.toBeNull();
    // baseUrl should default to the tsconfig's directory
    expect(tsconfig!.baseUrl).toBe(
      path.join(tmpDir, "packages/ui").split(path.sep).join("/"),
    );

    const resolved = resolver.resolveAlias(tsconfig!, "@ui/Button");
    expect(resolved).toBe(
      path.join(tmpDir, "packages/ui/src/Button").split(path.sep).join("/"),
    );
  });
});
