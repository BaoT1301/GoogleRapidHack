import { mkdir, mkdtemp, readFile, rm, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashSkillTree, type SkillFile } from "./skill-hash";
import {
  SkillSourceError,
  SkillSourceRegistry,
  type ResolvedSkillRef,
  type SkillBundle,
  type SkillSourceProvider,
} from "./skill-source";
import { GitHubSkillSource } from "./github-skill-source";
import { defaultSkillsLockPath } from "./skills-registry";
import { defaultSkillsRoot } from "../runtime/skill-materializer";

/**
 * SKILL-INSTALL — orchestrates installing a skill from a source into the local
 * store + lockfile. Flow:
 *   1. pick a provider for the raw source ref (pluggable registry),
 *   2. resolve the ref to an immutable commit + fetch the skill directory,
 *   3. validate the skill id (single safe path segment),
 *   4. stage the files to a temp dir, compute the deterministic tree hash,
 *   5. atomically swap the staged dir into `<SKILLS_ROOT>/<id>/`,
 *   6. mutex-guarded atomic read-modify-write of `skills-lock.json`.
 *
 * Both disk artifacts (store + lock) are updated atomically; a mid-flight failure
 * never leaves a partially written skill (staging is discarded). The store, not
 * the lockfile, is what the run-time materializer reads — so we MUST write content.
 */

/** A persisted lockfile entry. Additive over the legacy `{source,sourceType,skillPath,computedHash}`. */
export interface InstalledSkillEntry {
  source: string;
  sourceType: string;
  skillPath: string;
  computedHash: string;
  commit?: string;
  ref?: string;
  /** The exact raw source ref the user typed — used for a faithful re-pin. */
  sourceRef?: string;
  name?: string;
  description?: string;
  installedAt?: string;
}

export interface SkillsLockFile {
  version: number;
  skills: Record<string, InstalledSkillEntry>;
}

export interface InstallSkillInput {
  /** Raw source ref the user typed, e.g. `owner/repo:skills/foo@main`. */
  source: string;
  /** Optional explicit skill id; defaults to the provider's suggestion. */
  id?: string;
  /** Token for private sources / rate limits (never persisted, never logged). */
  token?: string;
  /** Allow replacing an existing skill of the same id (re-pin/overwrite). */
  overwrite?: boolean;
}

export interface InstallerDeps {
  registry?: SkillSourceRegistry;
  skillsRoot?: string;
  lockPath?: string;
  now?: () => Date;
}

export interface InstallSkillResult {
  id: string;
  entry: InstalledSkillEntry;
}

/** Default registry: GitHub now; new providers register here (or via deps). */
export function defaultSkillSourceRegistry(opts: { token?: string } = {}): SkillSourceRegistry {
  return new SkillSourceRegistry().register(new GitHubSkillSource({ token: opts.token }));
}

/** A safe skill id is a single path segment — no separators / traversal / dotfile. */
export function isSafeSkillId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 64 &&
    !/[/\\]/.test(id) &&
    !id.includes("..") &&
    !id.startsWith(".")
  );
}

/** Best-effort parse of `name`/`description` from a SKILL.md YAML frontmatter. */
function metaFromSkillMd(files: SkillFile[]): { name?: string; description?: string } {
  const skill = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
  if (!skill) return {};
  const text = typeof skill.content === "string" ? skill.content : skill.content.toString("utf8");
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!fm) return {};
  const body = fm[1];
  const grab = (key: string): string | undefined => {
    const m = new RegExp(`^${key}\\s*:\\s*(.+)$`, "im").exec(body);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
  };
  return { name: grab("name"), description: grab("description") };
}

// In-process mutex: serialize lockfile read-modify-write so concurrent installs
// never clobber each other (desktop single-server scope; not cross-process).
let lockChain: Promise<unknown> = Promise.resolve();
function withLockMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = lockChain.then(fn, fn);
  // Keep the chain alive regardless of success/failure.
  lockChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readLock(lockPath: string): Promise<SkillsLockFile> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SkillsLockFile>;
    const skills =
      parsed.skills && typeof parsed.skills === "object" && !Array.isArray(parsed.skills)
        ? (parsed.skills as Record<string, InstalledSkillEntry>)
        : {};
    return { version: typeof parsed.version === "number" ? parsed.version : 1, skills };
  } catch {
    return { version: 1, skills: {} };
  }
}

async function writeLockAtomic(lockPath: string, lock: SkillsLockFile): Promise<void> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const tmp = `${lockPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  await rename(tmp, lockPath);
}

/** Stage `files` to a temp dir, then atomically swap into `<skillsRoot>/<id>`. */
async function swapBundleIntoStore(
  skillsRoot: string,
  id: string,
  files: SkillFile[],
): Promise<void> {
  await mkdir(skillsRoot, { recursive: true });
  const staging = await mkdtemp(path.join(skillsRoot, `.staging-${id}-`));
  try {
    for (const f of files) {
      const rel = f.path.replace(/\\/g, "/");
      // Defense-in-depth: re-validate every entry stays under staging.
      const dest = path.join(staging, rel);
      const normalized = path.normalize(dest);
      if (!normalized.startsWith(path.normalize(staging) + path.sep)) {
        throw new SkillSourceError("unsafe-entry", `Refusing path outside skill dir: ${f.path}`);
      }
      await mkdir(path.dirname(normalized), { recursive: true });
      await writeFile(normalized, f.content);
    }

    const target = path.join(skillsRoot, id);
    const backup = `${target}.old-${Date.now()}`;
    let hadExisting = false;
    try {
      await rename(target, backup);
      hadExisting = true;
    } catch {
      // No existing target — fine.
    }
    try {
      await rename(staging, target);
    } catch (e) {
      // Restore the previous content on failure.
      if (hadExisting) {
        await rename(backup, target).catch(() => undefined);
      }
      throw e;
    }
    if (hadExisting) {
      await rm(backup, { recursive: true, force: true }).catch(() => undefined);
    }
  } finally {
    // Discard staging if it still exists (i.e. the swap failed before consuming it).
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

function reconstructRawRef(entry: Pick<InstalledSkillEntry, "source" | "skillPath" | "ref">): string {
  const sub = entry.skillPath ? `:${entry.skillPath}` : "";
  const ref = entry.ref ? `@${entry.ref}` : "";
  return `${entry.source}${sub}${ref}`;
}

/** Resolve + fetch a bundle for a raw source ref via the registry. */
async function fetchBundle(
  registry: SkillSourceRegistry,
  rawSource: string,
): Promise<{ provider: SkillSourceProvider; ref: ResolvedSkillRef; bundle: SkillBundle }> {
  const provider = registry.resolveProvider(rawSource);
  const ref = await provider.resolve(rawSource);
  const bundle = await provider.fetch(ref);
  return { provider, ref, bundle };
}

/**
 * Install a skill from `input.source`. Writes the content store + lockfile entry
 * atomically and returns the persisted entry. Throws `SkillSourceError` on
 * provider/validation failures (caller maps to a client error).
 */
export async function installSkill(
  input: InstallSkillInput,
  deps: InstallerDeps = {},
): Promise<InstallSkillResult> {
  const registry = deps.registry ?? defaultSkillSourceRegistry({ token: input.token });
  const skillsRoot = deps.skillsRoot ?? defaultSkillsRoot();
  const lockPath = deps.lockPath ?? defaultSkillsLockPath();
  const now = deps.now ?? (() => new Date());

  const { ref, bundle } = await fetchBundle(registry, input.source);

  const id = (input.id ?? bundle.suggestedId)?.trim();
  if (!isSafeSkillId(id)) {
    throw new SkillSourceError(
      "invalid-ref",
      `Invalid skill id "${id ?? ""}" — must be a single path segment (no / \\ .. and not dotfile).`,
    );
  }

  return withLockMutex(async () => {
    const lock = await readLock(lockPath);
    if (lock.skills[id] && !input.overwrite) {
      throw new SkillSourceError("invalid-ref", `Skill "${id}" already installed (use re-pin to update).`);
    }

    const computedHash = hashSkillTree(bundle.files);
    const meta = metaFromSkillMd(bundle.files);

    // Content store FIRST (atomic swap), then the lockfile — so the lock never
    // points at a skill whose content failed to land.
    await swapBundleIntoStore(skillsRoot, id, bundle.files);

    const entry: InstalledSkillEntry = {
      source: ref.source,
      sourceType: ref.sourceType,
      skillPath: ref.skillPath,
      computedHash,
      commit: ref.commit,
      ref: ref.ref,
      sourceRef: input.source,
      name: meta.name,
      description: meta.description,
      installedAt: now().toISOString(),
    };
    lock.skills[id] = entry;
    await writeLockAtomic(lockPath, lock);
    return { id, entry };
  });
}

/** Re-pin an installed skill: re-resolve its ref to the newest commit + re-fetch. */
export async function repinSkill(
  id: string,
  deps: InstallerDeps & { token?: string } = {},
): Promise<InstallSkillResult> {
  const lockPath = deps.lockPath ?? defaultSkillsLockPath();
  const lock = await readLock(lockPath);
  const existing = lock.skills[id];
  if (!existing) {
    throw new SkillSourceError("not-found", `Skill "${id}" is not installed.`);
  }
  return installSkill(
    { source: existing.sourceRef ?? reconstructRawRef(existing), id, token: deps.token, overwrite: true },
    deps,
  );
}

/** Remove an installed skill: drop the lock entry + remove its store directory. */
export async function removeSkill(id: string, deps: InstallerDeps = {}): Promise<{ removed: boolean }> {
  const skillsRoot = deps.skillsRoot ?? defaultSkillsRoot();
  const lockPath = deps.lockPath ?? defaultSkillsLockPath();
  if (!isSafeSkillId(id)) {
    throw new SkillSourceError("invalid-ref", `Invalid skill id "${id}".`);
  }
  return withLockMutex(async () => {
    const lock = await readLock(lockPath);
    const present = Boolean(lock.skills[id]);
    if (present) {
      delete lock.skills[id];
      await writeLockAtomic(lockPath, lock);
    }
    // Remove the store dir (guarded: id is a validated single segment).
    await rm(path.join(skillsRoot, id), { recursive: true, force: true }).catch(() => undefined);
    return { removed: present };
  });
}
