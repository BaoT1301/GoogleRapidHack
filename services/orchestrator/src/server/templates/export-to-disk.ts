import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { TemplateKind } from "../../db/models/template.model";

/**
 * TPL-3 — Export a workspace template fork (persona / rule) back to disk so it
 * persists into a TARGET project's `.claude/rules/personas` or `.claude/rules`.
 *
 * Hard containment guard (mirrors the SEC-3 `isPathInside` style):
 *   • the write MUST land inside the resolved target root (no traversal,
 *     no out-of-bounds);
 *   • the write MUST NOT land inside the orchestrator's OWN repo `.claude/`
 *     tree — only `knowledge_manager` may edit that (global master rules).
 *
 * The resolver is PURE + synchronous so it is fully unit-testable; the writer
 * is the only side-effecting function.
 */

/** Only persona/rule forks are exportable to disk. */
const KIND_SUBDIR: Partial<Record<TemplateKind, string>> = {
  persona: "rules/personas",
  rule: "rules",
};

export interface ExportRequest {
  /** The watched repo root (`graph.rootRepoPath`) — preferred target. */
  rootRepoPath?: string;
  /** Explicit owner-provided output dir (overrides `rootRepoPath` when set). */
  outDir?: string;
  kind: TemplateKind;
  id: string;
  /**
   * The orchestrator's own repo root — writes inside its `.claude/` are refused.
   * Defaults to `ORCH_SELF_REPO` env, else `<cwd>/../..` (the template repo root
   * when cwd is `services/orchestrator`). Injectable for testability.
   */
  selfRepoPath?: string;
}

export interface ResolvedExport {
  targetRoot: string;
  claudeDir: string;
  filePath: string;
  kind: TemplateKind;
  id: string;
}

export class ExportContainmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportContainmentError";
  }
}

/** True when `candidate` is the same as, or nested under, `parent` (SEC-3 style). */
function isPathInside(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate);
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveSelfRepo(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.ORCH_SELF_REPO) return resolve(process.env.ORCH_SELF_REPO);
  return resolve(process.cwd(), "../..");
}

/** A safe template id is a single path segment — no separators, no traversal. */
function assertSafeId(id: string): void {
  if (!id || typeof id !== "string") {
    throw new ExportContainmentError("Template id is required");
  }
  if (/[/\\]/.test(id) || id.includes("..") || id.startsWith(".")) {
    throw new ExportContainmentError(`Unsafe template id: "${id}"`);
  }
}

/**
 * Resolve (and validate) the on-disk path for an exported template fork. Throws
 * `ExportContainmentError` on any containment violation.
 */
export function resolveExportPath(req: ExportRequest): ResolvedExport {
  const subdir = KIND_SUBDIR[req.kind];
  if (!subdir) {
    throw new ExportContainmentError(
      `Only persona/rule templates can be exported to disk (got "${req.kind}")`,
    );
  }
  assertSafeId(req.id);

  const base = req.outDir ?? req.rootRepoPath;
  if (!base) {
    throw new ExportContainmentError("A rootRepoPath or outDir is required");
  }
  const targetRoot = resolve(base);
  const claudeDir = join(targetRoot, ".claude", subdir);
  const filePath = join(claudeDir, `${req.id}.md`);

  // 1) The write must stay inside the target root (defends traversal).
  if (!isPathInside(filePath, targetRoot)) {
    throw new ExportContainmentError(
      `Refusing to write outside the target root: ${filePath}`,
    );
  }

  // 2) The write must NOT land in the orchestrator's own repo `.claude/`.
  const selfRepo = resolveSelfRepo(req.selfRepoPath);
  const selfClaude = join(selfRepo, ".claude");
  if (isPathInside(filePath, selfClaude) || isPathInside(targetRoot, selfRepo)) {
    throw new ExportContainmentError(
      "Refusing to write into the orchestrator's own .claude/ tree " +
        "(only knowledge_manager may edit it)",
    );
  }

  return { targetRoot, claudeDir, filePath, kind: req.kind, id: req.id };
}

/**
 * Resolve + write a template fork to disk (atomic: write a temp sibling then
 * rename). Creates the target `.claude/<subdir>/` if missing. Returns the
 * written absolute path.
 */
export async function writeTemplateToDisk(
  req: ExportRequest & { content: string },
): Promise<string> {
  const resolved = resolveExportPath(req);
  await mkdir(resolved.claudeDir, { recursive: true });

  const tmp = join(
    dirname(resolved.filePath),
    `.${resolved.id}.${randomBytes(6).toString("hex")}.tmp`,
  );
  await writeFile(tmp, req.content, "utf8");
  await rename(tmp, resolved.filePath);
  return resolved.filePath;
}
