import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  TemplateModel,
  type TemplateKind,
} from "../db/models/template.model";

/**
 * Seed default templates of a single `kind` from a directory of `*.md` files
 * into Mongo. Idempotent (upsert keyed by `{id, source:"default", kind}`);
 * safe to run on every boot. Returns the number of templates seeded/updated.
 *
 * Shared core for `seedPersonas` / `seedRules` — Do-Not-Invent: one resolver,
 * two thin wrappers, so the existing `seedPersonas` export stays intact.
 */
async function seedTemplatesFromDir(
  dir: string,
  kind: TemplateKind,
): Promise<number> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    console.warn(`[seed] ${kind} dir not found: ${dir} — skipping`);
    return 0;
  }

  const mdFiles = files.filter((f) => f.endsWith(".md"));
  let seeded = 0;

  for (const file of mdFiles) {
    const content = await readFile(join(dir, file), "utf-8");
    const sha = createHash("sha256").update(content).digest("hex");
    const id = file.replace(/\.md$/, "");

    await TemplateModel.findOneAndUpdate(
      { id, source: "default", kind },
      {
        id,
        name: id.replace(/_/g, " "),
        kind,
        source: "default",
        content,
        sha,
        version: `default@${sha.slice(0, 8)}`,
      },
      { upsert: true, new: true },
    );
    seeded++;
  }

  return seeded;
}

/**
 * Seed the default persona templates from `.claude/personas/*.md` into Mongo.
 * Idempotent; safe to run on every boot. Returns the number seeded/updated.
 */
export async function seedPersonas(personasDir: string): Promise<number> {
  return seedTemplatesFromDir(personasDir, "persona");
}

/**
 * Seed the default rule templates from `.claude/rules/*.md` into Mongo as
 * `kind:"rule"`, `source:"default"`. Idempotent; mirrors `seedPersonas`.
 */
export async function seedRules(rulesDir: string): Promise<number> {
  return seedTemplatesFromDir(rulesDir, "rule");
}

/**
 * Seed once per process (lazy). Called from the templates router so the
 * crypto/fs-using seed code is only ever loaded by the nodejs route handler —
 * never by Next's edge bundle (which can't resolve `node:` builtins).
 */
const globalForSeed = globalThis as unknown as { __templatesSeeded?: boolean };

function personasDir(): string {
  return process.env.PERSONAS_DIR ?? resolve(process.cwd(), "../../.claude/personas");
}

function rulesDir(): string {
  return process.env.RULES_DIR ?? resolve(process.cwd(), "../../.claude/rules");
}

/**
 * Seed BOTH default personas and default rules once per process (lazy).
 * Supersedes `ensurePersonasSeeded` (kept as a back-compat alias below).
 */
export async function ensureTemplatesSeeded(): Promise<void> {
  if (globalForSeed.__templatesSeeded) return;
  await seedPersonas(personasDir());
  await seedRules(rulesDir());
  globalForSeed.__templatesSeeded = true;
}

/**
 * Back-compat export: existing callers expect persona seeding. Now seeds the
 * full template set (personas + rules) — a strict superset, so persona reads
 * are unaffected.
 */
export async function ensurePersonasSeeded(): Promise<void> {
  await ensureTemplatesSeeded();
}
