import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listDir } from "./list-dir";

const ex = promisify(execFile);

describe("listDir (repo-path directory browser)", () => {
  let root = "";

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "listdir-")));
    // Plain subdirs.
    await mkdir(path.join(root, "zeta"), { recursive: true });
    await mkdir(path.join(root, "alpha"), { recursive: true });
    await mkdir(path.join(root, ".hidden"), { recursive: true });
    // A file (must be excluded).
    await writeFile(path.join(root, "readme.txt"), "x");
    // A nested git repo.
    const repo = path.join(root, "my-repo");
    await mkdir(repo, { recursive: true });
    await ex("git", ["init"], { cwd: repo });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists only directories (no files), with git repos flagged and sorted first", async () => {
    const res = await listDir({ path: root });
    expect(res.path).toBe(root);

    const names = res.entries.map((e) => e.name);
    expect(names).not.toContain("readme.txt"); // files excluded
    expect(names).toContain("alpha");
    expect(names).toContain("zeta");
    expect(names).toContain("my-repo");

    // git repo sorts first.
    expect(res.entries[0]?.name).toBe("my-repo");
    expect(res.entries[0]?.isGitRepo).toBe(true);

    const hidden = res.entries.find((e) => e.name === ".hidden");
    expect(hidden?.isHidden).toBe(true);
    expect(hidden?.isGitRepo).toBe(false);
  });

  it("resolves the parent directory", async () => {
    const res = await listDir({ path: path.join(root, "my-repo") });
    expect(res.parent).toBe(root);
    expect(res.isGitRepo).toBe(true);
  });

  it("degrades a non-existent path without throwing", async () => {
    const res = await listDir({ path: path.join(root, "nope", "missing") });
    // Falls back to the default repo root (cwd-based) — just assert shape.
    expect(typeof res.path).toBe("string");
    expect(Array.isArray(res.entries)).toBe(true);
  });

  it("degrades a file path (not a directory) without throwing", async () => {
    const res = await listDir({ path: path.join(root, "readme.txt") });
    expect(Array.isArray(res.entries)).toBe(true);
  });
});
