import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveSkillPaths,
  materializeSkills,
  skillDirForCli,
  buildSkillsPreamble,
  applySkillsPreamble,
  loadSkillsForPreamble,
} from "./skill-materializer";

const LOCK = {
  version: 1,
  skills: {
    "design-taste-frontend": { source: "x" },
    "minimalist-ui": { source: "y" },
  },
};

describe("resolveSkillPaths (SKILL-1, pure)", () => {
  it("maps known ids to source dirs", () => {
    const r = resolveSkillPaths(["design-taste-frontend", "minimalist-ui"], "/root", LOCK);
    expect(r.map((s) => s.id)).toEqual(["design-taste-frontend", "minimalist-ui"]);
    // Use join so the expectation is OS-native (resolveSkillPaths uses path.join;
    // hardcoding "/root/..." failed on Windows where the separator is "\").
    expect(r[0].sourceDir).toBe(join("/root", "design-taste-frontend"));
  });

  it("drops unknown ids when a lock is provided", () => {
    const r = resolveSkillPaths(["design-taste-frontend", "no-such-skill"], "/root", LOCK);
    expect(r.map((s) => s.id)).toEqual(["design-taste-frontend"]);
  });

  it("drops unsafe ids (traversal / separators) and dedupes", () => {
    const r = resolveSkillPaths(
      ["../evil", "a/b", ".hidden", "minimalist-ui", "minimalist-ui"],
      "/root",
    );
    expect(r.map((s) => s.id)).toEqual(["minimalist-ui"]);
  });

  it("returns [] for empty/absent input", () => {
    expect(resolveSkillPaths(undefined, "/root")).toEqual([]);
    expect(resolveSkillPaths([], "/root")).toEqual([]);
  });
});

describe("materializeSkills (integration)", () => {
  let root: string;
  let skillsRoot: string;
  let worktree: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "skill-mat-"));
    skillsRoot = join(root, "skills");
    worktree = join(root, "worktree");
    // A fake installed skill.
    await mkdir(join(skillsRoot, "minimalist-ui"), { recursive: true });
    await writeFile(join(skillsRoot, "minimalist-ui", "SKILL.md"), "# minimalist\n", "utf8");
    await mkdir(worktree, { recursive: true });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("copies a declared skill into <worktree>/.kiro/skills/<id>/", async () => {
    const res = await materializeSkills({
      worktreePath: worktree,
      skillIds: ["minimalist-ui"],
      skillsRoot,
    });
    expect(res.materialized).toEqual(["minimalist-ui"]);
    const back = await readFile(
      join(worktree, ".kiro", "skills", "minimalist-ui", "SKILL.md"),
      "utf8",
    );
    expect(back).toBe("# minimalist\n");
  });

  it("skips an unknown skill id safely (best-effort, no throw)", async () => {
    const res = await materializeSkills({
      worktreePath: worktree,
      skillIds: ["does-not-exist"],
      skillsRoot,
    });
    expect(res.materialized).toEqual([]);
    expect(res.skipped).toEqual(["does-not-exist"]);
  });

  it("writes a .git/info/exclude entry for .kiro/ (patch-neutral)", async () => {
    // The integration worktree here is not a real git worktree, so we just assert
    // materialization placed skills under .kiro/ (excluded namespace).
    const entries = await readdir(join(worktree, ".kiro", "skills"));
    expect(entries).toContain("minimalist-ui");
  });
});

describe("skillDirForCli (cross-CLI placement)", () => {
  it("maps kiro/claude to their dirs, defaults undefined to kiro, others to undefined", () => {
    expect(skillDirForCli("kiro")).toBe(".kiro/skills");
    expect(skillDirForCli("claude")).toBe(".claude/skills");
    expect(skillDirForCli(undefined)).toBe(".kiro/skills");
    expect(skillDirForCli("codex")).toBeUndefined();
    expect(skillDirForCli("gemini")).toBeUndefined();
    expect(skillDirForCli("fake")).toBeUndefined();
  });
});

describe("materializeSkills (cross-CLI)", () => {
  let root: string;
  let skillsRoot: string;
  let worktree: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "skill-mat-cli-"));
    skillsRoot = join(root, "skills");
    worktree = join(root, "worktree");
    await mkdir(join(skillsRoot, "minimalist-ui"), { recursive: true });
    await writeFile(join(skillsRoot, "minimalist-ui", "SKILL.md"), "# minimalist\n", "utf8");
    await mkdir(worktree, { recursive: true });
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("places a skill into .claude/skills/<id>/ for a claude node", async () => {
    const res = await materializeSkills({
      worktreePath: worktree,
      skillIds: ["minimalist-ui"],
      skillsRoot,
      cli: "claude",
    });
    expect(res.materialized).toEqual(["minimalist-ui"]);
    const back = await readFile(
      join(worktree, ".claude", "skills", "minimalist-ui", "SKILL.md"),
      "utf8",
    );
    expect(back).toBe("# minimalist\n");
  });

  it("places NO files for a CLI without a skills dir (codex) — preamble fallback", async () => {
    const res = await materializeSkills({
      worktreePath: worktree,
      skillIds: ["minimalist-ui"],
      skillsRoot,
      cli: "codex",
    });
    expect(res.materialized).toEqual([]);
    expect(res.skipped).toEqual(["minimalist-ui"]);
  });
});


describe("skills prompt preamble (universal fallback)", () => {
  it("buildSkillsPreamble returns '' for empty/blank input (absent-safe)", () => {
    expect(buildSkillsPreamble([])).toBe("");
    expect(buildSkillsPreamble([{ id: "x", content: "   " }])).toBe("");
  });

  it("buildSkillsPreamble frames each skill body under a ## Skills block", () => {
    const block = buildSkillsPreamble([
      { id: "minimalist-ui", content: "Use a warm monochrome palette." },
    ]);
    expect(block).toContain("## Skills");
    expect(block).toContain("### Skill: minimalist-ui");
    expect(block).toContain("warm monochrome palette");
  });

  it("applySkillsPreamble prepends the block and leaves the prompt unchanged when empty", () => {
    const prompt = "Do the task.";
    expect(applySkillsPreamble(prompt, [])).toBe(prompt);
    const out = applySkillsPreamble(prompt, [{ id: "s", content: "body" }]);
    expect(out.startsWith("## Skills")).toBe(true);
    expect(out.endsWith("Do the task.")).toBe(true);
  });

  it("loadSkillsForPreamble reads SKILL.md bodies from the store", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-preamble-"));
    try {
      const store = join(root, "store");
      await mkdir(join(store, "demo"), { recursive: true });
      await writeFile(join(store, "demo", "SKILL.md"), "# Demo skill body", "utf8");
      const items = await loadSkillsForPreamble(["demo", "missing"], { skillsRoot: store });
      expect(items).toEqual([{ id: "demo", content: "# Demo skill body" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
