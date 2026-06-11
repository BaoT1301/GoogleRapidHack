import { describe, expect, it, vi } from "vitest";
import { GitHubSkillSource, parseGitHubRef } from "./github-skill-source";
import { SkillSourceError } from "./skill-source";

/** Build a fake `fetch` that maps a URL substring → {status, body}. */
function makeFetch(
  routes: Array<{ match: string; status?: number; body?: unknown }>,
  seen?: Array<{ url: string; headers: Record<string, string> }>,
): typeof fetch {
  return (async (url: string, init?: { headers?: Record<string, string> }) => {
    seen?.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
    const route = routes.find((r) => url.includes(r.match));
    const status = route?.status ?? (route ? 200 : 404);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route?.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("parseGitHubRef", () => {
  it("parses owner/repo", () => {
    expect(parseGitHubRef("owner/repo")).toMatchObject({ owner: "owner", repo: "repo", subdir: "" });
  });
  it("parses subdir + ref", () => {
    expect(parseGitHubRef("owner/repo:skills/foo@main")).toMatchObject({
      owner: "owner",
      repo: "repo",
      subdir: "skills/foo",
      ref: "main",
    });
  });
  it("parses github: scheme and strips .git", () => {
    expect(parseGitHubRef("github:owner/repo.git")).toMatchObject({ owner: "owner", repo: "repo" });
  });
  it("parses a web tree URL", () => {
    expect(parseGitHubRef("https://github.com/o/r/tree/v1/skills/foo")).toMatchObject({
      owner: "o",
      repo: "r",
      ref: "v1",
      subdir: "skills/foo",
    });
  });
  it("throws invalid-ref for a non-github string", () => {
    expect(() => parseGitHubRef("not a ref")).toThrowError(SkillSourceError);
  });
});

describe("GitHubSkillSource.canHandle", () => {
  const p = new GitHubSkillSource({ fetchImpl: makeFetch([]) });
  it("recognizes shorthand, scheme and web url", () => {
    expect(p.canHandle("owner/repo")).toBe(true);
    expect(p.canHandle("owner/repo:skills/foo@main")).toBe(true);
    expect(p.canHandle("github:o/r")).toBe(true);
    expect(p.canHandle("https://github.com/o/r")).toBe(true);
  });
  it("ignores fake refs and arbitrary urls", () => {
    expect(p.canHandle("fake:x")).toBe(false);
    expect(p.canHandle("https://example.com/x")).toBe(false);
    expect(p.canHandle("a/b/c")).toBe(false);
  });
});

describe("GitHubSkillSource.resolve", () => {
  it("pins a ref to an immutable commit and forwards the token", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const p = new GitHubSkillSource({
      token: "secret-token",
      fetchImpl: makeFetch([{ match: "/commits/main", body: { sha: "abc123" } }], seen),
    });
    const ref = await p.resolve("owner/repo:skills/foo@main");
    expect(ref).toMatchObject({
      sourceType: "github",
      source: "owner/repo",
      commit: "abc123",
      skillPath: "skills/foo",
    });
    expect(seen[0].headers.Authorization).toBe("Bearer secret-token");
  });

  it("maps 404 → not-found", async () => {
    const p = new GitHubSkillSource({
      fetchImpl: makeFetch([{ match: "/commits/", status: 404 }]),
    });
    await expect(p.resolve("owner/repo@nope")).rejects.toMatchObject({ code: "not-found" });
  });

  it("maps 403 → auth", async () => {
    const p = new GitHubSkillSource({
      fetchImpl: makeFetch([{ match: "/commits/", status: 403 }]),
    });
    await expect(p.resolve("owner/repo")).rejects.toMatchObject({ code: "auth" });
  });
});

describe("GitHubSkillSource.fetch", () => {
  const ref = {
    sourceType: "github",
    source: "owner/repo",
    commit: "abc123",
    skillPath: "skills/foo",
  };

  it("returns files under the subdir with the prefix stripped", async () => {
    const p = new GitHubSkillSource({
      fetchImpl: makeFetch([
        {
          match: "/git/trees/abc123",
          body: {
            truncated: false,
            tree: [
              { path: "README.md", mode: "100644", type: "blob", sha: "r", size: 3 },
              { path: "skills/foo/SKILL.md", mode: "100644", type: "blob", sha: "s1", size: 8 },
              { path: "skills/foo/assets/a.txt", mode: "100644", type: "blob", sha: "s2", size: 5 },
            ],
          },
        },
        { match: "/git/blobs/s1", body: { content: b64("# skill\n"), encoding: "base64" } },
        { match: "/git/blobs/s2", body: { content: b64("alpha"), encoding: "base64" } },
      ]),
    });
    const bundle = await p.fetch(ref);
    expect(bundle.suggestedId).toBe("foo");
    const paths = bundle.files.map((f) => f.path).sort();
    expect(paths).toEqual(["SKILL.md", "assets/a.txt"]);
    // The README outside the subdir is excluded.
    expect(paths).not.toContain("README.md");
  });

  it("rejects a symlink entry (mode 120000)", async () => {
    const p = new GitHubSkillSource({
      fetchImpl: makeFetch([
        {
          match: "/git/trees/abc123",
          body: {
            truncated: false,
            tree: [{ path: "skills/foo/link", mode: "120000", type: "blob", sha: "x", size: 4 }],
          },
        },
      ]),
    });
    await expect(p.fetch(ref)).rejects.toMatchObject({ code: "unsafe-entry" });
  });

  it("rejects when the file count exceeds the limit", async () => {
    const tree = Array.from({ length: 3 }, (_, i) => ({
      path: `skills/foo/f${i}.txt`,
      mode: "100644",
      type: "blob" as const,
      sha: `s${i}`,
      size: 1,
    }));
    const p = new GitHubSkillSource({
      limits: { maxFiles: 2 },
      fetchImpl: makeFetch([
        { match: "/git/trees/abc123", body: { truncated: false, tree } },
        { match: "/git/blobs/", body: { content: b64("x"), encoding: "base64" } },
      ]),
    });
    await expect(p.fetch(ref)).rejects.toMatchObject({ code: "too-large" });
  });

  it("throws not-found when the subdir has no files", async () => {
    const p = new GitHubSkillSource({
      fetchImpl: makeFetch([
        {
          match: "/git/trees/abc123",
          body: {
            truncated: false,
            tree: [{ path: "other/x.md", mode: "100644", type: "blob", sha: "x", size: 1 }],
          },
        },
      ]),
    });
    await expect(p.fetch(ref)).rejects.toMatchObject({ code: "not-found" });
  });
});
