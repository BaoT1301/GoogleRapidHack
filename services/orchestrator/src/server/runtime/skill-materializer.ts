import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { excludeFromWorktree } from "./runtime-mcp-config";
import type { SupportedCli } from "./types";

/**
 * SKILL-1 — Materialize attached skills into a run worktree's `.kiro/skills/`
 * before the CLI spawns, so the agent actually has the skill knowledge at run
 * time. Mirrors the agent-config materialization (`reviewer-agent.ts`): pure
 * resolver for testability + a best-effort side-effecting copier that NEVER
 * aborts the run, and keeps `.kiro/` out of the captured patch (SEC-3 neutral).
 */

/** Shape of the repo-root `skills-lock.json` (lockfile read-only; never executed). */
export interface SkillsLock {
  version?: number;
  skills?: Record<string, unknown>;
}

export interface ResolvedSkill {
  id: string;
  /** Absolute source dir under the skills root (`<skillsRoot>/<id>`). */
  sourceDir: string;
}

/** A safe skill id is a single path segment — no separators / traversal / dotfile. */
function isSafeSkillId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    !/[/\\]/.test(id) &&
    !id.includes("..") &&
    !id.startsWith(".")
  );
}

/**
 * PURE resolver: map requested skill ids to their source dirs under `skillsRoot`.
 * Deduplicates, drops unsafe ids, and — when a `lock` is provided — keeps only ids
 * present in the lockfile (`lock.skills`). Unknown/garbage ids are skipped safely.
 * Never touches the filesystem.
 */
export function resolveSkillPaths(
  skillIds: string[] | undefined,
  skillsRoot: string,
  lock?: SkillsLock,
): ResolvedSkill[] {
  if (!Array.isArray(skillIds) || skillIds.length === 0) return [];
  const known = lock && lock.skills && typeof lock.skills === "object"
    ? new Set(Object.keys(lock.skills))
    : null;

  const seen = new Set<string>();
  const out: ResolvedSkill[] = [];
  for (const raw of skillIds) {
    if (!isSafeSkillId(raw)) continue;
    if (seen.has(raw)) continue;
    if (known && !known.has(raw)) continue;
    seen.add(raw);
    out.push({ id: raw, sourceDir: path.join(skillsRoot, raw) });
  }
  return out;
}

/** Default skills root: `SKILLS_ROOT` env, else the repo `.kiro/skills`. */
export function defaultSkillsRoot(): string {
  return process.env.SKILLS_ROOT ?? path.resolve(process.cwd(), "../../.kiro/skills");
}

/**
 * Per-CLI, worktree-RELATIVE directory a skill is materialized into so the target
 * agent actually discovers it. CLIs absent from this map have no native skill
 * directory convention and instead receive skill knowledge via the universal
 * prompt preamble (see `buildSkillsPreamble`) — so we place no files for them.
 */
export const CLI_SKILL_DIRS: Partial<Record<SupportedCli, string>> = {
  kiro: ".kiro/skills",
  claude: ".claude/skills",
};

/**
 * Worktree-relative skills dir for a CLI. An undefined `cli` defaults to kiro's
 * `.kiro/skills` (back-compat). A CLI with no file convention → `undefined`
 * (no file placement; the prompt preamble carries the skill instead).
 */
export function skillDirForCli(cli?: SupportedCli): string | undefined {
  if (cli === undefined) return CLI_SKILL_DIRS.kiro;
  return CLI_SKILL_DIRS[cli];
}

export interface MaterializeSkillsInput {
  worktreePath: string;
  skillIds: string[] | undefined;
  /** Defaults to `defaultSkillsRoot()`. */
  skillsRoot?: string;
  lock?: SkillsLock;
  /** Target CLI — selects the placement dir. Absent → kiro (back-compat). */
  cli?: SupportedCli;
}

export interface MaterializeSkillsResult {
  materialized: string[];
  skipped: string[];
  notes: string[];
}

/**
 * Copy each resolved skill dir into the target CLI's skills dir under the
 * worktree (e.g. kiro → `.kiro/skills/<id>/`, claude → `.claude/skills/<id>/`).
 * Best-effort: a missing/unreadable source skill is skipped, never fatal. CLIs
 * with no native skills dir place no files (they get the prompt preamble). The
 * written namespace (e.g. `.kiro/`, `.claude/`) is excluded from the worktree's
 * tracked tree so materialized skills never pollute the captured patch / trip the
 * SEC-3 scope guard.
 */
export async function materializeSkills(
  input: MaterializeSkillsInput,
): Promise<MaterializeSkillsResult> {
  const skillsRoot = input.skillsRoot ?? defaultSkillsRoot();
  const resolved = resolveSkillPaths(input.skillIds, skillsRoot, input.lock);
  const materialized: string[] = [];
  const skipped: string[] = [];

  const relDir = skillDirForCli(input.cli);
  if (!relDir) {
    // No file-placement convention for this CLI — skills are delivered via the
    // prompt preamble (assembled separately by the runner). Never throws.
    return {
      materialized: [],
      skipped: resolved.map((r) => r.id),
      notes:
        resolved.length > 0
          ? [`No skills dir for cli=${input.cli}; skills delivered via prompt preamble.`]
          : [],
    };
  }

  for (const skill of resolved) {
    try {
      const srcStat = await stat(skill.sourceDir);
      if (!srcStat.isDirectory()) {
        skipped.push(skill.id);
        continue;
      }
      const dest = path.join(input.worktreePath, relDir, skill.id);
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(skill.sourceDir, dest, { recursive: true });
      materialized.push(skill.id);
    } catch {
      // best-effort: a single skill failure never aborts the run.
      skipped.push(skill.id);
    }
  }

  if (materialized.length > 0) {
    // Exclude ONLY the skills subdir we wrote (e.g. `.kiro/skills/`,
    // `.claude/skills/`) from the worktree's tracked tree so materialized skills
    // never pollute the captured patch / trip the SEC-3 scope guard. We exclude
    // the narrow subdir (not the whole `.claude/` namespace) so a doc node's
    // legitimate `.claude/**` edits stay visible + in-scope.
    try {
      await excludeFromWorktree(input.worktreePath, `${relDir}/`);
    } catch {
      // best-effort: exclusion failure is non-fatal.
    }
  }

  return {
    materialized,
    skipped,
    notes:
      materialized.length > 0
        ? [`Materialized skills into ${relDir}/: ${materialized.join(", ")}`]
        : [],
  };
}


/**
 * SKILL — universal prompt-preamble fallback. For CLIs with no native skills
 * directory (`skillDirForCli` → undefined: codex/gemini/fake), the only reliable
 * channel to deliver skill knowledge is the prompt itself. These helpers read
 * each skill's `SKILL.md` from the store and fold the bodies into a bounded,
 * clearly-framed `## Skills` block prepended to the node prompt.
 */

export interface SkillPreambleItem {
  id: string;
  content: string;
}

/** Per-skill + total caps so the preamble can never blow the prompt budget. */
const MAX_SKILL_CHARS = 6000;
const MAX_TOTAL_PREAMBLE_CHARS = 20000;

/** Read each installed skill's `SKILL.md` body from the store (best-effort). */
export async function loadSkillsForPreamble(
  skillIds: string[] | undefined,
  opts: { skillsRoot?: string; lock?: SkillsLock } = {},
): Promise<SkillPreambleItem[]> {
  const skillsRoot = opts.skillsRoot ?? defaultSkillsRoot();
  const resolved = resolveSkillPaths(skillIds, skillsRoot, opts.lock);
  const items: SkillPreambleItem[] = [];
  for (const skill of resolved) {
    try {
      const md = await readFile(path.join(skill.sourceDir, "SKILL.md"), "utf8");
      if (md.trim().length > 0) items.push({ id: skill.id, content: md });
    } catch {
      // best-effort: a missing/unreadable SKILL.md is skipped.
    }
  }
  return items;
}

/** Build a bounded `## Skills` preamble block. Empty input → "" (absent-safe). */
export function buildSkillsPreamble(items: SkillPreambleItem[]): string {
  const valid = items.filter((i) => i.content.trim().length > 0);
  if (valid.length === 0) return "";
  const blocks: string[] = [];
  let total = 0;
  for (const item of valid) {
    const trimmed = item.content.trim();
    const body =
      trimmed.length <= MAX_SKILL_CHARS ? trimmed : `${trimmed.slice(0, MAX_SKILL_CHARS)}\n…[truncated]`;
    const block = `### Skill: ${item.id}\n\n${body}`;
    if (total + block.length > MAX_TOTAL_PREAMBLE_CHARS) break;
    total += block.length;
    blocks.push(block);
  }
  return [
    "## Skills",
    "",
    "Apply the following installed skill instructions to this task. Treat them as",
    "authoritative guidance for how to approach the work:",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

/**
 * Prepend the `## Skills` preamble to a prompt. Returns the prompt UNCHANGED when
 * there are no skill bodies (absent-safe → byte-identical to before).
 */
export function applySkillsPreamble(prompt: string, items: SkillPreambleItem[]): string {
  const block = buildSkillsPreamble(items);
  if (block.length === 0) return prompt;
  return `${block}\n\n---\n\n${prompt}`;
}
