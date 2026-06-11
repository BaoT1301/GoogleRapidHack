import { describe, expect, it } from "vitest";
import {
  SkillSourceRegistry,
  SkillSourceError,
  type SkillSourceProvider,
  type ResolvedSkillRef,
  type SkillBundle,
} from "./skill-source";

/** In-memory provider for `fake:<id>` refs — no network, deterministic. */
export function makeFakeProvider(
  files: SkillBundle["files"] = [{ path: "SKILL.md", content: "# fake\n" }],
): SkillSourceProvider {
  return {
    type: "fake",
    canHandle: (raw) => raw.startsWith("fake:"),
    async resolve(raw): Promise<ResolvedSkillRef> {
      const id = raw.slice("fake:".length);
      if (!id) throw new SkillSourceError("invalid-ref", "fake ref needs an id");
      return {
        sourceType: "fake",
        source: id,
        commit: "0".repeat(40),
        skillPath: `skills/${id}`,
        ref: "main",
      };
    },
    async fetch(ref): Promise<SkillBundle> {
      return { ref, suggestedId: ref.source, files };
    },
  };
}

describe("SkillSourceRegistry (SKILL-INSTALL)", () => {
  it("routes a recognized ref to its provider", () => {
    const reg = new SkillSourceRegistry().register(makeFakeProvider());
    const provider = reg.resolveProvider("fake:foo");
    expect(provider.type).toBe("fake");
  });

  it("resolves + fetches an in-memory bundle end-to-end", async () => {
    const reg = new SkillSourceRegistry().register(makeFakeProvider());
    const provider = reg.resolveProvider("fake:minimalist");
    const ref = await provider.resolve("fake:minimalist");
    expect(ref).toMatchObject({ sourceType: "fake", source: "minimalist", commit: "0".repeat(40) });
    const bundle = await provider.fetch(ref);
    expect(bundle.suggestedId).toBe("minimalist");
    expect(bundle.files[0].path).toBe("SKILL.md");
  });

  it("throws no-provider for an unrecognized ref", () => {
    const reg = new SkillSourceRegistry().register(makeFakeProvider());
    try {
      reg.resolveProvider("https://example.com/x");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SkillSourceError);
      expect((e as SkillSourceError).code).toBe("no-provider");
    }
  });

  it("throws invalid-ref for an empty ref", () => {
    const reg = new SkillSourceRegistry().register(makeFakeProvider());
    expect(() => reg.resolveProvider("   ")).toThrowError(SkillSourceError);
  });

  it("honors registration order (first match wins)", () => {
    const first = { ...makeFakeProvider(), type: "first" } as SkillSourceProvider;
    const second = { ...makeFakeProvider(), type: "second" } as SkillSourceProvider;
    const reg = new SkillSourceRegistry().register(first).register(second);
    expect(reg.resolveProvider("fake:x").type).toBe("first");
  });
});
