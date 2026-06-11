import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * SKILL-2 — Read-only skills registry. Parses the repo-root `skills-lock.json`
 * lockfile into a UI-friendly list. LOCKFILE READ ONLY — it never executes
 * anything and never throws: an absent/garbage lock yields `[]`.
 */

export interface SkillListItem {
  id: string;
  name: string;
  description?: string;
  source?: string;
}

/** Title-case a skill id, e.g. `minimalist-ui` → `Minimalist Ui`. */
function titleFromId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * PURE: parse a (already-read) skills-lock value into a list. Tolerant of any
 * shape — absent/garbage → `[]`. Never throws.
 */
export function parseSkillsLock(raw: unknown): SkillListItem[] {
  if (!raw || typeof raw !== "object") return [];
  const skills = (raw as { skills?: unknown }).skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) return [];

  const out: SkillListItem[] = [];
  for (const [id, entry] of Object.entries(skills as Record<string, unknown>)) {
    if (typeof id !== "string" || id.length === 0) continue;
    const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    out.push({
      id,
      name: titleFromId(id),
      description: typeof e.description === "string" ? e.description : undefined,
      source: typeof e.source === "string" ? e.source : undefined,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Default lock path: `SKILLS_LOCK_PATH` env, else the repo-root `skills-lock.json`. */
export function defaultSkillsLockPath(): string {
  return process.env.SKILLS_LOCK_PATH ?? path.resolve(process.cwd(), "../../skills-lock.json");
}

/**
 * Best-effort read + parse of the skills lockfile. Never throws — a missing or
 * malformed file yields `[]`.
 */
export async function readSkillsRegistry(lockPath?: string): Promise<SkillListItem[]> {
  const file = lockPath ?? defaultSkillsLockPath();
  try {
    const raw = await readFile(file, "utf8");
    return parseSkillsLock(JSON.parse(raw));
  } catch {
    return [];
  }
}
