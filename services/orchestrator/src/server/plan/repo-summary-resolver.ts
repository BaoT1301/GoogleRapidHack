/**
 * Local repo-summary resolver (PLAN-1 feed, Cloud Infra P2).
 *
 * The codebaseContext pipe (codebase-context.ts) was built but UNFED — the plan
 * router resolved with no resolver, so the planner reasoned blind. This module is
 * the missing server-side resolver: a bounded, best-effort scan of the local repo
 * that yields real facts (languages, key files, exported symbols, a README/package
 * summary). Wired into plan.generate, it makes BOTH planners codebase-aware (the
 * Cloud planner gets it baked into the request; the local kiro prompt renders it).
 *
 * It is deliberately a lightweight filesystem scan, not the full mcp-context-manager
 * index — the resolver is injectable, so a richer MCP/structural-graph-backed
 * resolver can replace it later (P3/P4) without touching the router. Everything is
 * bounded + best-effort + secret-scrubbed downstream by sanitizeCodebaseContext.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CodebaseContext, CodebaseContextResolver } from "./codebase-context";

const IGNORE_DIRS = new Set([
  "node_modules", ".next", "dist", "build", "out", "coverage", ".turbo",
  ".cache", "vendor", "__pycache__", ".venv", "venv", ".idea", ".vscode",
]);

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
  ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".go": "Go",
  ".rs": "Rust", ".java": "Java", ".rb": "Ruby", ".php": "PHP", ".cs": "C#",
  ".cpp": "C++", ".cc": "C++", ".c": "C", ".swift": "Swift", ".kt": "Kotlin",
  ".scala": "Scala", ".sql": "SQL", ".sh": "Shell",
};

const SOURCE_EXTS = new Set(Object.keys(LANG_BY_EXT));

// Bounds — keep the scan fast but gather a RICH set (B1). The stored KB holds
// this; query_codebase narrows to the relevant top-K per request, so storing more
// only improves recall (a big repo is no longer truncated before retrieval runs).
const SCAN_FILE_CAP = 8000;
const MAX_DEPTH = 10;
const PRE_FILE_LIST_CAP = 800;
const PRE_SYMBOL_CAP = 1200;
const SYMBOL_FILE_SAMPLE = 400;
const SYMBOL_FILE_MAX_BYTES = 64 * 1024;
const README_EXCERPT_CHARS = 1500;

const JS_SYMBOL_RE =
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const PY_SYMBOL_RE = /^\s*(?:def|class)\s+([A-Za-z_]\w*)/gm;

interface ScanResult {
  files: string[];
  sourceFiles: string[];
  langCount: Map<string, number>;
  topLevel: string[];
  total: number;
}

/** Bounded breadth-ish walk that skips noise dirs and caps total work. */
async function scanRepo(root: string): Promise<ScanResult> {
  const files: string[] = [];
  const sourceFiles: string[] = [];
  const langCount = new Map<string, number>();
  const topLevel: string[] = [];
  let total = 0;

  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    if (total >= SCAN_FILE_CAP) break;
    const { dir, depth } = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (total >= SCAN_FILE_CAP) break;
      const name = entry.name;
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        if (name.startsWith(".") || IGNORE_DIRS.has(name)) continue;
        if (depth === 0) topLevel.push(`${name}/`);
        if (depth < MAX_DEPTH) stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        total++;
        if (depth === 0) topLevel.push(name);
        const ext = path.extname(name).toLowerCase();
        const lang = LANG_BY_EXT[ext];
        if (lang) langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
        if (SOURCE_EXTS.has(ext)) {
          const rel = path.relative(root, full).split(path.sep).join("/");
          if (files.length < PRE_FILE_LIST_CAP) files.push(rel);
          if (sourceFiles.length < SYMBOL_FILE_SAMPLE) sourceFiles.push(full);
        }
      }
    }
  }
  return { files, sourceFiles, langCount, topLevel, total };
}

/** Read a small set of source files and extract exported/defined symbol names. */
async function extractSymbols(root: string, sourceFiles: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const full of sourceFiles) {
    if (out.length >= PRE_SYMBOL_CAP) break;
    let content: string;
    try {
      const buf = await fs.readFile(full, "utf8");
      content = buf.length > SYMBOL_FILE_MAX_BYTES ? buf.slice(0, SYMBOL_FILE_MAX_BYTES) : buf;
    } catch {
      continue;
    }
    const rel = path.relative(root, full).split(path.sep).join("/");
    const re = full.endsWith(".py") ? PY_SYMBOL_RE : JS_SYMBOL_RE;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null && out.length < PRE_SYMBOL_CAP) {
      const sym = `${m[1]} — ${rel}`;
      if (!seen.has(sym)) {
        seen.add(sym);
        out.push(sym);
      }
    }
  }
  return out;
}

async function readFirst(root: string, names: string[], max: number): Promise<string | undefined> {
  for (const n of names) {
    try {
      const buf = await fs.readFile(path.join(root, n), "utf8");
      return buf.slice(0, max);
    } catch {
      // try next
    }
  }
  return undefined;
}

async function buildSummary(root: string, scan: ScanResult): Promise<string> {
  const lines: string[] = [];

  // package.json name/description (best-effort).
  try {
    const pkgRaw = await fs.readFile(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: string; description?: string };
    if (pkg.name) lines.push(`Project: ${pkg.name}${pkg.description ? ` — ${pkg.description}` : ""}`);
  } catch {
    // no/invalid package.json — fine
  }

  const langs = [...scan.langCount.entries()].sort((a, b) => b[1] - a[1]);
  if (langs.length > 0) {
    lines.push(`Languages: ${langs.map(([l, c]) => `${l} (${c})`).join(", ")}`);
  }
  if (scan.topLevel.length > 0) {
    lines.push(`Top level: ${scan.topLevel.slice(0, 40).sort().join(", ")}`);
  }

  const readme = await readFirst(
    root,
    ["README.md", "readme.md", "Readme.md", "README.MD"],
    README_EXCERPT_CHARS,
  );
  if (readme && readme.trim().length > 0) {
    lines.push("", "README excerpt:", readme.trim());
  }

  return lines.join("\n");
}

/** Summarize the repo at `root` into a CodebaseContext, or undefined if unusable. */
export async function summarizeRepo(root: string): Promise<CodebaseContext | undefined> {
  const scan = await scanRepo(root);
  if (scan.total === 0) return undefined; // not a readable/real repo → omit (byte-compatible)

  const symbols = await extractSymbols(root, scan.sourceFiles);
  const langs = [...scan.langCount.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);

  const context: CodebaseContext = {
    repoSummary: await buildSummary(root, scan),
    files: scan.files.length > 0 ? scan.files : undefined,
    symbols: symbols.length > 0 ? symbols : undefined,
    stats: {
      fileCount: scan.total,
      symbolCount: symbols.length > 0 ? symbols.length : undefined,
      languages: langs.length > 0 ? langs : undefined,
    },
  };
  return context;
}

/**
 * Build a CodebaseContextResolver bound to a repo path. Never throws — any failure
 * resolves to undefined so the plan path stays byte-for-byte backward compatible.
 */
export function createRepoSummaryResolver(opts: { cwd: string }): CodebaseContextResolver {
  return async () => {
    try {
      return await summarizeRepo(opts.cwd);
    } catch {
      return undefined;
    }
  };
}
