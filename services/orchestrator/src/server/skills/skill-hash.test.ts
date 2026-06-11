import { describe, expect, it } from "vitest";
import { hashSkillTree, verifySkillTree, hashSkillFileContent } from "./skill-hash";

describe("hashSkillTree (SKILL-INSTALL integrity)", () => {
  it("is independent of file order", () => {
    const a = hashSkillTree([
      { path: "SKILL.md", content: "# skill\n" },
      { path: "assets/a.txt", content: "alpha" },
    ]);
    const b = hashSkillTree([
      { path: "assets/a.txt", content: "alpha" },
      { path: "SKILL.md", content: "# skill\n" },
    ]);
    expect(a).toBe(b);
  });

  it("is independent of path separator style", () => {
    const posix = hashSkillTree([{ path: "assets/a.txt", content: "x" }]);
    const win = hashSkillTree([{ path: "assets\\a.txt", content: "x" }]);
    const dotted = hashSkillTree([{ path: "./assets/a.txt", content: "x" }]);
    expect(posix).toBe(win);
    expect(posix).toBe(dotted);
  });

  it("changes when any content changes", () => {
    const base = hashSkillTree([{ path: "SKILL.md", content: "# v1" }]);
    const changed = hashSkillTree([{ path: "SKILL.md", content: "# v2" }]);
    expect(changed).not.toBe(base);
  });

  it("changes when a path changes", () => {
    const base = hashSkillTree([{ path: "SKILL.md", content: "x" }]);
    const renamed = hashSkillTree([{ path: "OTHER.md", content: "x" }]);
    expect(renamed).not.toBe(base);
  });

  it("treats Buffer and string content equivalently", () => {
    const s = hashSkillTree([{ path: "a", content: "héllo" }]);
    const b = hashSkillTree([{ path: "a", content: Buffer.from("héllo", "utf8") }]);
    expect(s).toBe(b);
  });

  it("produces a stable 64-char hex digest for the empty tree", () => {
    const h = hashSkillTree([]);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSkillTree([])).toBe(h);
  });

  it("verifySkillTree round-trips and rejects mismatches / bad input", () => {
    const files = [{ path: "SKILL.md", content: "# skill" }];
    const expected = hashSkillTree(files);
    expect(verifySkillTree(files, expected)).toBe(true);
    expect(verifySkillTree([{ path: "SKILL.md", content: "tampered" }], expected)).toBe(false);
    expect(verifySkillTree(files, "")).toBe(false);
    // @ts-expect-error invalid expected type is tolerated (returns false)
    expect(verifySkillTree(files, undefined)).toBe(false);
  });

  it("hashSkillFileContent is a 64-char hex sha256", () => {
    expect(hashSkillFileContent("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
