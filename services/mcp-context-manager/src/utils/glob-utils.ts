import { ToolInputError } from "./tool-input-error.js";

/**
 * Validates a glob pattern, throwing ToolInputError for common authoring mistakes.
 * - Rejects comma-separated globs without brace-expansion (e.g. "*.ts,*.tsx")
 * - Rejects absolute paths
 */
export function validateGlob(glob: string): void {
  if (glob.includes(",") && !glob.includes("{")) {
    throw new ToolInputError(
      `Comma in glob without brace-expansion: "${glob}". ` +
        `Use "{ext1,ext2}" instead, e.g. "*.{ts,tsx}".`,
    );
  }
  if (glob.startsWith("/") || /^[A-Za-z]:[/\\]/.test(glob)) {
    throw new ToolInputError(
      `Absolute paths are not valid globs: "${glob}". ` +
        `Use a pattern relative to the workspace, e.g. "src/**/*.ts".`,
    );
  }
}

/**
 * Compiles a regex pattern, throwing ToolInputError with actionable hints on failure.
 */
export function validateRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    const msg = (err as Error).message;
    let hint = "";
    if (/character class/i.test(msg)) {
      hint = " Hint: escape '[' as '\\[', or use ['\"] to match both quote characters.";
    } else if (/unterminated group/i.test(msg)) {
      hint = " Hint: count your parentheses — one '(' per ')'.";
    }
    throw new ToolInputError(`Invalid regex: ${msg}${hint}\nPattern: ${pattern}`);
  }
}

/**
 * Splits a comma-separated glob string while preserving brace expansions.
 * e.g. "app/**\/*.{ts,tsx},lib/**\/*.ts" → ["app/**\/*.{ts,tsx}", "lib/**\/*.ts"]
 */
export function splitCsvRespectingBraces(s: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") depth--;
    else if (s[i] === "," && depth === 0) {
      const token = s.slice(start, i).trim();
      if (token) results.push(token);
      start = i + 1;
    }
  }

  const last = s.slice(start).trim();
  if (last) results.push(last);

  return results;
}

export const DEFAULT_IGNORE_PATTERNS: string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/coverage/**",
  "**/.git/**",
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/.tools/mcp-context-*/**",
  // NOTE: **/services/mcp-context-*/** is intentionally NOT in the default list.
  // When this repo is the indexed workspace, that pattern would block its own source.
  // Add it via WATCH_IGNORES env var if you need to exclude it in a host project.
  "**/.kiro/**",
  "**/.claude/**",
];

/**
 * Returns the resolved ignore patterns.
 * Reads WATCH_IGNORES env var (brace-aware split); falls back to DEFAULT_IGNORE_PATTERNS.
 */
export function resolveIgnorePatterns(): string[] {
  const env = process.env.WATCH_IGNORES;
  if (env?.trim()) {
    return splitCsvRespectingBraces(env);
  }
  return DEFAULT_IGNORE_PATTERNS;
}
