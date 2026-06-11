import {
  SkillSourceError,
  type ResolvedSkillRef,
  type SkillBundle,
  type SkillSourceProvider,
} from "./skill-source";
import type { SkillFile } from "./skill-hash";

/**
 * SKILL-INSTALL — GitHub source provider. Accepts shorthand refs:
 *   - `owner/repo`                       (default branch HEAD, whole repo as skill)
 *   - `owner/repo@<ref>`                 (branch / tag / sha)
 *   - `owner/repo:skills/foo`            (subdirectory is the skill)
 *   - `owner/repo:skills/foo@<ref>`
 *   - `github:owner/repo...`             (explicit scheme)
 *   - `https://github.com/owner/repo/tree/<ref>/skills/foo` (web URL)
 *
 * `resolve` pins the human ref to an immutable commit SHA (reproducible installs).
 * `fetch` reads the git tree at that commit, keeps only blobs under `skillPath`,
 * REJECTS symlinks / submodules / traversal, and enforces file-count + byte
 * limits. The token (for private repos / rate limits) is injected, never logged.
 */

export interface GitHubProviderLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_GITHUB_LIMITS: GitHubProviderLimits = {
  maxFiles: 200,
  maxTotalBytes: 5 * 1024 * 1024, // 5 MiB total
  maxFileBytes: 2 * 1024 * 1024, // 2 MiB per file
};

export interface GitHubProviderOptions {
  /** PAT for private repos / higher rate limits. Read from env when omitted. */
  token?: string;
  /** GitHub API base (override for GH Enterprise / tests). */
  apiBase?: string;
  /** Injected fetch (tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  limits?: Partial<GitHubProviderLimits>;
}

interface ParsedGitHubRef {
  owner: string;
  repo: string;
  subdir: string; // POSIX, no leading/trailing slash ("" = repo root)
  ref?: string; // branch/tag/sha as requested
}

const SHORTHAND_RE = /^[\w.-]+\/[\w.-]+(:[^@]*)?(@.+)?$/;
const WEB_URL_RE =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/;

function stripSlashes(p: string): string {
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** A safe in-tree entry: relative, POSIX, no traversal / absolute / drive. */
function isSafeTreePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split("/").some((seg) => seg === ".." || seg === ".");
}

/** Sanitize a candidate skill id to a single safe path segment. */
function sanitizeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/[-.]+$/, "")
    .slice(0, 64);
}

export function parseGitHubRef(raw: string): ParsedGitHubRef {
  const trimmed = raw.trim();

  const url = WEB_URL_RE.exec(trimmed);
  if (url) {
    const [, owner, repo, ref, subdir] = url;
    return { owner, repo, subdir: stripSlashes(subdir ?? ""), ref };
  }

  let s = trimmed.replace(/^github:/, "");
  let ref: string | undefined;
  const at = s.lastIndexOf("@");
  if (at > 0) {
    ref = s.slice(at + 1).trim() || undefined;
    s = s.slice(0, at);
  }
  let subdir = "";
  const colon = s.indexOf(":");
  if (colon >= 0) {
    subdir = stripSlashes(s.slice(colon + 1));
    s = s.slice(0, colon);
  }
  const parts = s.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new SkillSourceError("invalid-ref", `Not a GitHub source: ${raw}`);
  }
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, ""), subdir, ref };
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export class GitHubSkillSource implements SkillSourceProvider {
  readonly type = "github";
  private readonly token?: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limits: GitHubProviderLimits;

  constructor(opts: GitHubProviderOptions = {}) {
    this.token =
      opts.token ?? process.env.SKILLS_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? undefined;
    this.apiBase = (opts.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.limits = { ...DEFAULT_GITHUB_LIMITS, ...(opts.limits ?? {}) };
  }

  canHandle(raw: string): boolean {
    const t = raw.trim();
    if (t.startsWith("github:")) return true;
    if (WEB_URL_RE.test(t)) return true;
    if (t.startsWith("fake:")) return false; // leave fake refs to the fake provider
    return SHORTHAND_RE.test(t);
  }

  private async api<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.apiBase}${pathOrUrl}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "orchestrator-skill-installer",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers });
    } catch (e) {
      throw new SkillSourceError("network", `GitHub request failed: ${(e as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new SkillSourceError(
        "auth",
        `GitHub denied access (${res.status}). Provide a token with repo read access.`,
      );
    }
    if (res.status === 404) {
      throw new SkillSourceError("not-found", "GitHub resource not found (repo/ref/path).");
    }
    if (!res.ok) {
      throw new SkillSourceError("network", `GitHub responded ${res.status}.`);
    }
    return (await res.json()) as T;
  }

  async resolve(raw: string): Promise<ResolvedSkillRef> {
    const parsed = parseGitHubRef(raw);
    const ref = parsed.ref ?? "HEAD";
    const commit = await this.api<{ sha: string }>(
      `/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(ref)}`,
    );
    if (!commit?.sha) {
      throw new SkillSourceError("not-found", `Could not resolve ref "${ref}" to a commit.`);
    }
    return {
      sourceType: "github",
      source: `${parsed.owner}/${parsed.repo}`,
      commit: commit.sha,
      skillPath: parsed.subdir,
      ref: parsed.ref,
    };
  }

  async fetch(ref: ResolvedSkillRef): Promise<SkillBundle> {
    const [owner, repo] = ref.source.split("/");
    const subdir = stripSlashes(ref.skillPath ?? "");

    const tree = await this.api<{ tree: GitTreeEntry[]; truncated?: boolean }>(
      `/repos/${owner}/${repo}/git/trees/${ref.commit}?recursive=1`,
    );
    if (tree.truncated) {
      throw new SkillSourceError("too-large", "Repository tree too large to fetch safely.");
    }

    const prefix = subdir ? `${subdir}/` : "";
    const blobs = tree.tree.filter(
      (e) => e.path === subdir || e.path.startsWith(prefix) || subdir === "",
    );

    // Security: reject anything that is not a plain blob (mode 120000 = symlink,
    // 160000 = submodule appear as type "commit"/special modes) or escapes the dir.
    const files: SkillFile[] = [];
    let totalBytes = 0;
    let count = 0;

    for (const entry of blobs) {
      if (entry.type === "tree") continue;
      if (entry.type !== "blob") {
        throw new SkillSourceError("unsafe-entry", `Refusing non-file entry: ${entry.path}`);
      }
      if (entry.mode === "120000" || entry.mode === "160000") {
        throw new SkillSourceError("unsafe-entry", `Refusing symlink/submodule: ${entry.path}`);
      }
      const rel = subdir ? entry.path.slice(prefix.length) : entry.path;
      if (!isSafeTreePath(rel)) {
        throw new SkillSourceError("unsafe-entry", `Refusing unsafe path: ${entry.path}`);
      }
      if ((entry.size ?? 0) > this.limits.maxFileBytes) {
        throw new SkillSourceError("too-large", `File exceeds size limit: ${entry.path}`);
      }
      count += 1;
      if (count > this.limits.maxFiles) {
        throw new SkillSourceError("too-large", "Skill exceeds the max file count.");
      }

      const blob = await this.api<{ content: string; encoding: string }>(
        `/repos/${owner}/${repo}/git/blobs/${entry.sha}`,
      );
      const content =
        blob.encoding === "base64"
          ? Buffer.from(blob.content, "base64")
          : Buffer.from(blob.content, "utf8");
      totalBytes += content.byteLength;
      if (totalBytes > this.limits.maxTotalBytes) {
        throw new SkillSourceError("too-large", "Skill exceeds the total size limit.");
      }
      files.push({ path: rel, content });
    }

    if (files.length === 0) {
      throw new SkillSourceError("not-found", "No files found at the requested skill path.");
    }

    const suggestedBase = subdir ? subdir.split("/").pop()! : repo;
    return { ref, suggestedId: sanitizeId(suggestedBase), files };
  }
}
