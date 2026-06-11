import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepoSummaryResolver, summarizeRepo } from "./repo-summary-resolver";

const tempRoots: string[] = [];

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "repo-summary-"));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return root;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("summarizeRepo", () => {
  it("returns undefined for an empty / non-existent dir (byte-compatible omission)", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "repo-summary-empty-"));
    tempRoots.push(empty);
    expect(await summarizeRepo(empty)).toBeUndefined();
    expect(await summarizeRepo(path.join(empty, "does-not-exist"))).toBeUndefined();
  });

  it("summarizes languages, files, symbols and a package/README summary", async () => {
    const root = await makeRepo({
      "package.json": JSON.stringify({ name: "demo-app", description: "a test repo" }),
      "README.md": "# Demo App\nThis is the readme.",
      "src/auth.ts":
        "export function authenticate(token: string) { return token; }\nexport const SESSION = 1;",
      "src/util.py": "def helper():\n    return 1\nclass Thing:\n    pass\n",
      "node_modules/dep/index.js": "export const SHOULD_NOT_APPEAR = 1;",
    });

    const ctx = await summarizeRepo(root);
    expect(ctx).toBeDefined();
    // Languages detected from real extensions.
    expect(ctx?.stats?.languages).toEqual(
      expect.arrayContaining(["TypeScript", "Python"]),
    );
    // Source files listed, ignored dirs excluded.
    expect(ctx?.files).toEqual(
      expect.arrayContaining(["src/auth.ts", "src/util.py"]),
    );
    expect(ctx?.files?.some((f) => f.includes("node_modules"))).toBe(false);
    // Symbols extracted (TS exports + Python defs/classes), tagged with file.
    expect(ctx?.symbols?.some((s) => s.startsWith("authenticate — src/auth.ts"))).toBe(true);
    expect(ctx?.symbols?.some((s) => s.startsWith("helper — src/util.py"))).toBe(true);
    expect(ctx?.symbols?.some((s) => s.startsWith("Thing — src/util.py"))).toBe(true);
    // Summary carries the project name + README excerpt.
    expect(ctx?.repoSummary).toContain("demo-app");
    expect(ctx?.repoSummary).toContain("Demo App");
  });

  it("createRepoSummaryResolver never throws (returns undefined on a bad path)", async () => {
    const resolver = createRepoSummaryResolver({ cwd: path.join(os.tmpdir(), "nope-xyz") });
    await expect(resolver()).resolves.toBeUndefined();
  });
});
