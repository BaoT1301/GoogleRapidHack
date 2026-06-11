import { createHash } from "node:crypto";
import path from "node:path";

import type { FileParseResult, Language, RangePosition } from "../types/schema.js";

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function pos(row: number, column: number): RangePosition {
  return { line: row + 1, column: column + 1 };
}

export function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function detectLanguage(filePath: string): Language | null {
  if (filePath.endsWith(".py")) {
    return "python";
  }
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".js") || filePath.endsWith(".jsx")) {
    return "typescript";
  }
  return null;
}

export function emptyParseResult(filePath: string, language: Language, content: string): FileParseResult {
  return {
    filePath: normalizePath(filePath),
    language,
    hash: hashContent(content),
    symbols: [],
    relations: [],
    parsedImports: [],
    resolvedImports: [],
    parseErrors: [],
  };
}
