import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installSkill,
  removeSkill,
  repinSkill,
  isSafeSkillId,
  type SkillsLockFile,
} from "./skill-installer";
import {
  SkillSourceRegistry,
  SkillSourceError,
  type SkillSourceProvider,
  type SkillBundle,
} from "./skill-source";

/** Configurable in-memory provider: `fake:<id>` → bundle, with a mutable commit. */
function fakeRegistry(opts: {
  files?: SkillBundle["files"];
  commit?: string;
  suggestedId?: string;
}): SkillSourceRegistry {
  const provider: SkillSourceProvider = {
    type: "fake",
    canHandle: (raw) => raw.startsWith("fake:"),
    async resolve(raw) {
      const source = raw.slice("fake:".length).split("@")[0];
      return {
        sourceType: "fake",
        source,
        commit: opts.commit ?? "commit-1",
        skillPath: "",
        ref: "main",
      };
    },
    async fetch(ref) {
      return {
        ref,
        suggestedId: opts.suggestedId ?? ref.source,
        files: opts.files ?? [
          { path: "SKILL.md", content: "---\nname: Demo\ndescription: A demo skill\n---\n# demo\n" },
        ],
      };
    },
  };
  return new SkillSourceRegistry().register(provider);
}

describe("isSafeSkillId", () => {
  it("accepts a simple segment, rejects traversal/separators/dotfiles", () => {
    expect(isSafeSkillId("minimalist-ui")).toBe(true);
    expect(isSafeSkillId("../evil")).toBe(false);
    expect(isSafeSkillId("a/b")).toBe(false);
    expect(isSafeSkillId(".hidden")).toBe(false);
    expect(isSafeSkillId("")).toBe(false);
  });
});

describe("installSkill (SKILL-INSTALL)", () => {
  let root: string;
  let skillsRoot: string;
  let lockPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "skill-install-"));
    skillsRoot = join(root, "store");
    lockPath = join(root, "skills-lock.json");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const readLock = async (): Promise<SkillsLockFile> =>
    JSON.parse(await readFile(lockPath, "utf8"));

  it("writes content to the store AND a pinned lock entry", async () => {
    const res = await installSkill(
      { source: "fake:demo" },
      { registry: fakeRegistry({}), skillsRoot, lockPath },
    );
    expect(res.id).toBe("demo");
    expect(res.entry.commit).toBe("commit-1");
    expect(res.entry.computedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.entry.name).toBe("Demo");
    expect(res.entry.description).toBe("A demo skill");

    // Content landed on disk (this is what the materializer reads).
    const skillMd = await readFile(join(skillsRoot, "demo", "SKILL.md"), "utf8");
    expect(skillMd).toContain("# demo");

    // Lock entry persisted.
    const lock = await readLock();
    expect(lock.skills.demo.source).toBe("demo");
    expect(lock.skills.demo.sourceType).toBe("fake");
  });

  it("uses an explicit id when provided", async () => {
    const res = await installSkill(
      { source: "fake:demo", id: "custom-id" },
      { registry: fakeRegistry({}), skillsRoot, lockPath },
    );
    expect(res.id).toBe("custom-id");
    await readFile(join(skillsRoot, "custom-id", "SKILL.md"), "utf8");
  });

  it("rejects an unsafe explicit id (no disk write)", async () => {
    await expect(
      installSkill(
        { source: "fake:demo", id: "../escape" },
        { registry: fakeRegistry({}), skillsRoot, lockPath },
      ),
    ).rejects.toMatchObject({ code: "invalid-ref" });
    await expect(readdir(skillsRoot)).rejects.toBeTruthy(); // store never created
  });

  it("refuses to overwrite an existing skill unless overwrite=true", async () => {
    const deps = { registry: fakeRegistry({}), skillsRoot, lockPath };
    await installSkill({ source: "fake:demo" }, deps);
    await expect(installSkill({ source: "fake:demo" }, deps)).rejects.toMatchObject({
      code: "invalid-ref",
    });
    // overwrite succeeds
    const again = await installSkill({ source: "fake:demo", overwrite: true }, deps);
    expect(again.id).toBe("demo");
  });

  it("hash changes when content changes", async () => {
    const a = await installSkill(
      { source: "fake:demo" },
      { registry: fakeRegistry({ files: [{ path: "SKILL.md", content: "v1" }] }), skillsRoot, lockPath },
    );
    const b = await installSkill(
      { source: "fake:demo", overwrite: true },
      { registry: fakeRegistry({ files: [{ path: "SKILL.md", content: "v2" }] }), skillsRoot, lockPath },
    );
    expect(b.entry.computedHash).not.toBe(a.entry.computedHash);
  });

  it("preserves other entries when adding/removing (read-modify-write)", async () => {
    const deps = { registry: fakeRegistry({}), skillsRoot, lockPath };
    await installSkill({ source: "fake:alpha", id: "alpha" }, deps);
    await installSkill({ source: "fake:beta", id: "beta" }, deps);
    let lock = await readLock();
    expect(Object.keys(lock.skills).sort()).toEqual(["alpha", "beta"]);

    await removeSkill("alpha", { skillsRoot, lockPath });
    lock = await readLock();
    expect(Object.keys(lock.skills)).toEqual(["beta"]);
    await expect(readdir(join(skillsRoot, "alpha"))).rejects.toBeTruthy();
  });

  it("concurrent installs do not corrupt the lock", async () => {
    const deps = { registry: fakeRegistry({}), skillsRoot, lockPath };
    await Promise.all([
      installSkill({ source: "fake:a", id: "a" }, deps),
      installSkill({ source: "fake:b", id: "b" }, deps),
      installSkill({ source: "fake:c", id: "c" }, deps),
    ]);
    const lock = await readLock();
    expect(Object.keys(lock.skills).sort()).toEqual(["a", "b", "c"]);
  });

  it("re-pin re-resolves to the newest commit and updates the entry", async () => {
    await installSkill(
      { source: "fake:demo", id: "demo" },
      { registry: fakeRegistry({ commit: "commit-1" }), skillsRoot, lockPath },
    );
    const repinned = await repinSkill("demo", {
      registry: fakeRegistry({ commit: "commit-2", files: [{ path: "SKILL.md", content: "new" }] }),
      skillsRoot,
      lockPath,
    });
    expect(repinned.entry.commit).toBe("commit-2");
    const lock = await readLock();
    expect(lock.skills.demo.commit).toBe("commit-2");
  });

  it("re-pin throws not-found for an unknown skill", async () => {
    await expect(
      repinSkill("ghost", { registry: fakeRegistry({}), skillsRoot, lockPath }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("remove reports removed=false when absent (idempotent)", async () => {
    const res = await removeSkill("nope", { skillsRoot, lockPath });
    expect(res.removed).toBe(false);
  });

  it("overwrite preserves prior content when the swap target already exists", async () => {
    const deps = { registry: fakeRegistry({}), skillsRoot, lockPath };
    await installSkill({ source: "fake:demo", id: "demo" }, deps);
    // Pre-existing extra file should be gone after overwrite (clean swap).
    await mkdir(join(skillsRoot, "demo"), { recursive: true });
    await writeFile(join(skillsRoot, "demo", "stale.txt"), "old", "utf8");
    await installSkill(
      { source: "fake:demo", id: "demo", overwrite: true },
      { registry: fakeRegistry({ files: [{ path: "SKILL.md", content: "fresh" }] }), skillsRoot, lockPath },
    );
    await expect(readFile(join(skillsRoot, "demo", "stale.txt"), "utf8")).rejects.toBeTruthy();
    expect(await readFile(join(skillsRoot, "demo", "SKILL.md"), "utf8")).toBe("fresh");
  });
});
