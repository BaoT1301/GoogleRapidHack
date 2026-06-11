export type Language = "python" | "typescript";

export type SymbolKind = "file" | "module" | "function" | "class" | "variable" | "external";

export type EdgeType =
  | "imports"
  | "defines"
  | "calls"
  | "instantiates"
  | "reads"
  | "writes"
  | "references"
  | "exports"
  | "inherits";

export interface RangePosition {
  line: number;
  column: number;
}

export interface SymbolDefinition {
  id: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  language: Language;
  filePath: string;
  rangeStart: RangePosition;
  rangeEnd: RangePosition;
}

export interface SymbolRelation {
  type: EdgeType;
  sourceSymbolId: string;
  targetSymbolId?: string;
  targetQualifiedName?: string;
  filePath: string;
  confidence: number;
}

export interface ParsedImport {
  raw: string;
  isRelative: boolean;
}

export type ImportResolution =
  | { kind: "resolved"; filePath: string }
  | { kind: "skipped-external"; specifier: string }
  | { kind: "unresolved-relative"; specifier: string; searched: string[] }
  | { kind: "unresolved-alias"; specifier: string; tsconfig: string | null; searched: string[] }
  | { kind: "unresolved-unknown"; specifier: string };

export interface UnresolvedImportEntry {
  specifier: string;
  reason: "missing-file" | "alias-no-match" | "alias-no-tsconfig" | "other";
  searched?: string[];
}

export interface FileParseResult {
  filePath: string;
  language: Language;
  hash: string;
  symbols: SymbolDefinition[];
  relations: SymbolRelation[];
  parsedImports: ParsedImport[];
  resolvedImports: string[];
  parseErrors: string[];
  unresolvedImports?: UnresolvedImportEntry[];
}

export interface GraphNode {
  id: string;
  label: string;
  kind: SymbolKind;
  language: Language;
  filePath?: string;
  qualifiedName?: string;
  rangeStart?: RangePosition;
  rangeEnd?: RangePosition;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
  filePath: string;
}

export interface GraphExport {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
