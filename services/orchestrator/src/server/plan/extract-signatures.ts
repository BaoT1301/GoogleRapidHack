/**
 * Phase 4 — local signature/docstring enrichment. The mcp KB stores bare symbol
 * names ("AppError — src/lib/api/response.ts"), which embed into weak vectors. The
 * orchestrator already runs LOCALLY with the repo on disk (locality law) and the mcp
 * nodes carry a `filePath` + `rangeStart.line`, so we read each declaration line + its
 * leading doc-comment locally and fold that into the symbol text. Richer text → much
 * better semantic embeddings, and the planner sees the signature for free.
 *
 * Best-effort: any unreadable file / out-of-range line leaves the symbol unchanged
 * (alignment preserved). The fs wrapper caches each file read once per sync.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Cap on the enriched symbol string (kept compact for embeddings + storage). */
// Must stay < the storage clamp (codebase-context CODEBASE_STORAGE_LIMITS.itemChars =
// 200), INCLUDING the "…" suffix below, so the persisted symbol text isn't truncated a
// second time. Re-truncation would shift the embed-cache key (text-keyed) and could
// alias two long symbols that share a prefix. 199 + "…" = 200 = itemChars.
const MAX_ENRICHED = 199;
/** How many leading comment lines to fold in. */
const MAX_COMMENT_LINES = 3;

export interface SymbolToEnrich {
  /** The base symbol string, e.g. "AppError — src/lib/api/response.ts". */
  symbol: string;
  /** Path reported by mcp (absolute, or relative to the repo root). */
  filePath?: string;
  /** 1-based declaration line from mcp `rangeStart.line`. */
  line?: number;
}

const COMMENT_PREFIX = /^(\/\/+|#+|\*+|\/\*+)/;

function cleanComment(line: string): string {
  return line
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .replace(/^\/\/+/, "")
    .replace(/^#+/, "")
    .replace(/^\*+/, "")
    .trim();
}

/**
 * Fold the declaration line + its leading comment block into the symbol string.
 * Pure (given the file's lines) so it is unit-tested without fs. Returns the symbol
 * unchanged when there's no usable line.
 */
export function enrichFromLines(symbol: string, lines: string[], line?: number): string {
  if (!line || line < 1 || line > lines.length) return symbol;
  const idx = line - 1; // mcp lines are 1-based
  const sig = (lines[idx] ?? "").trim();

  // Walk upward collecting a contiguous leading comment block (JSDoc `*`, `//`, `#`).
  const comment: string[] = [];
  for (let i = idx - 1; i >= 0 && comment.length < MAX_COMMENT_LINES; i--) {
    const t = (lines[i] ?? "").trim();
    if (t === "" || !COMMENT_PREFIX.test(t)) break;
    const c = cleanComment(t);
    if (c) comment.unshift(c);
  }

  let out = sig ? `${symbol} :: ${sig}` : symbol;
  const doc = comment.join(" ").trim();
  if (doc) out += ` — ${doc}`;
  return out.length > MAX_ENRICHED ? `${out.slice(0, MAX_ENRICHED)}…` : out;
}

/**
 * Enrich a batch of symbols by reading their files locally (each file read once).
 * `repoPath` resolves relative `filePath`s. Best-effort + never throws — on any
 * failure a symbol is returned unchanged so the output stays aligned to the input.
 */
export async function enrichSymbols(
  repoPath: string,
  items: SymbolToEnrich[],
): Promise<string[]> {
  const fileCache = new Map<string, string[] | null>();

  async function linesFor(filePath: string): Promise<string[] | null> {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath);
    if (fileCache.has(abs)) return fileCache.get(abs) ?? null;
    let lines: string[] | null = null;
    try {
      const text = await readFile(abs, "utf8");
      lines = text.split(/\r?\n/);
    } catch {
      lines = null;
    }
    fileCache.set(abs, lines);
    return lines;
  }

  const out: string[] = [];
  for (const it of items) {
    if (!it.filePath || !it.line) {
      out.push(it.symbol);
      continue;
    }
    const lines = await linesFor(it.filePath);
    out.push(lines ? enrichFromLines(it.symbol, lines, it.line) : it.symbol);
  }
  return out;
}
