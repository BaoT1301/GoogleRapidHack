import { describe, expect, it } from "vitest";
import { parseSkillsLock } from "./skills-registry";

describe("parseSkillsLock (SKILL-2)", () => {
  it("parses a valid lock into a sorted list", () => {
    const list = parseSkillsLock({
      version: 1,
      skills: {
        "minimalist-ui": { source: "Leonxlnx/taste-skill", sourceType: "github" },
        "design-taste-frontend": { source: "Leonxlnx/taste-skill" },
      },
    });
    expect(list.map((s) => s.id)).toEqual(["design-taste-frontend", "minimalist-ui"]);
    expect(list[1]).toMatchObject({
      id: "minimalist-ui",
      name: "Minimalist Ui",
      source: "Leonxlnx/taste-skill",
    });
  });

  it("returns [] for absent/garbage locks (never throws)", () => {
    expect(parseSkillsLock(undefined)).toEqual([]);
    expect(parseSkillsLock(null)).toEqual([]);
    expect(parseSkillsLock({})).toEqual([]);
    expect(parseSkillsLock({ skills: "nope" })).toEqual([]);
    expect(parseSkillsLock({ skills: [] })).toEqual([]);
    expect(parseSkillsLock("garbage")).toEqual([]);
  });
});
