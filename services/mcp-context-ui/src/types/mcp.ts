import { z } from "zod";

/**
 * MCP Graph Type Definitions
 *
 * These schemas define the structure of data returned from the MCP Context Manager
 * via the FastAPI backend proxy endpoints.
 */

// Node types in the dependency graph
// Using .passthrough() to preserve extra fields (lat, lng, clusterId) added by the globe extensions
export const NodeSchema = z.object({
  id: z.string(),
  type: z.enum(["file", "function", "class", "variable", "module", "external"]),
  label: z.string(),
  filePath: z.string().optional(),
  qualifiedName: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const EdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum([
    "imports",
    "defines",
    "calls",
    "instantiates",
    "reads",
    "writes",
    "references",
    "exports",
    "inherits",
  ]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  isCrossCluster: z.boolean().optional(),
});

export const GraphSchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  meta: z.object({
    generatedAt: z.string(),
    scope: z.string(),
    truncated: z.boolean(),
    nodeCount: z.number(),
    edgeCount: z.number(),
  }).optional(),
  clusterMeta: z.array(z.object({
    id: z.string(),
    path: z.string(),
    label: z.string(),
    color: z.string(),
  })).optional(),
});

// Function context response (includes center node)
// centerNode is nullable — backend returns null when root is not found in the graph
export const FunctionContextSchema = GraphSchema.extend({
  centerNode: NodeSchema.nullable().optional(),
  relatedFiles: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
});

// File dependents response
export const FileDependencySchema = z.object({
  filePath: z.string(),
  dependencyType: z.enum(["incoming", "outgoing"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const FileDependentsSchema = z.object({
  files: z.array(z.string()),
  dependencies: z.array(FileDependencySchema),
  summary: z.object({
    incomingCount: z.number(),
    outgoingCount: z.number(),
    truncated: z.boolean(),
  }).optional(),
});

// Symbol references response
export const SymbolReferenceSchema = z.object({
  filePath: z.string(),
  line: z.number(),
  column: z.number(),
  referenceType: z.enum(["read", "write", "call"]),
  context: z.string().optional(),
});

// symbol is nullable — backend returns null when the symbol is not found in the graph
export const SymbolReferencesSchema = z.object({
  symbol: NodeSchema.nullable(),
  references: z.array(SymbolReferenceSchema),
  truncated: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Sprint 1 + Sprint 2 — Advanced Query Response Schemas
// ---------------------------------------------------------------------------

// Sprint 1: Get Callers (reverse call graph)
export const CallersResponseSchema = z.object({
  target: NodeSchema.nullable(),
  callers: z.array(
    z.object({
      node: NodeSchema,
      depth: z.number(),
      callEdge: z.any().optional(),
    }),
  ),
  truncated: z.boolean(),
});

// Sprint 1: Get Call Chain (directed subgraph)
export const CallChainResponseSchema = z.object({
  root: NodeSchema.nullable(),
  chain: GraphSchema,
  truncated: z.boolean(),
});

// Sprint 1: Get Dead Code
export const DeadCodeResponseSchema = z.object({
  deadSymbols: z.array(
    z.object({
      node: NodeSchema,
      definedIn: z.string(),
    }),
  ),
  totalScanned: z.number(),
  truncated: z.boolean(),
});

// Sprint 1: Get Impact Analysis
export const ImpactAnalysisResponseSchema = z.object({
  sourceFile: z.string(),
  affectedFiles: z.array(
    z.object({
      filePath: z.string(),
      depth: z.number(),
      impactType: z.enum(["direct", "transitive"]),
    }),
  ),
  affectedSymbols: z.array(NodeSchema),
  riskScore: z.number(),
  suggestedTestFiles: z.array(z.string()),
  truncated: z.boolean(),
});

// Sprint 2: Get Module Coupling
export const ModuleCouplingResponseSchema = z.object({
  filePathA: z.string(),
  filePathB: z.string(),
  sharedImports: z.number(),
  sharedSymbols: z.number(),
  directEdges: z.number(),
  transitiveEdges: z.number(),
  couplingScore: z.number(),
  truncated: z.boolean(),
});

// Sprint 2: Get Hotspots
export const HotspotsResponseSchema = z.object({
  hotspots: z.array(
    z.object({
      node: NodeSchema,
      fanIn: z.number(),
      fanOut: z.number(),
      edgeBreakdown: z.record(z.string(), z.number()),
    }),
  ),
  totalSymbolsScanned: z.number(),
  truncated: z.boolean(),
});

// Sprint 2: Get Class Hierarchy
export const ClassHierarchyResponseSchema = z.object({
  root: NodeSchema.nullable(),
  ancestors: z.array(
    z.object({
      node: NodeSchema,
      depth: z.number(),
    }),
  ),
  descendants: z.array(
    z.object({
      node: NodeSchema,
      depth: z.number(),
    }),
  ),
  hierarchy: GraphSchema,
  truncated: z.boolean(),
});

// Sprint 2: Search Symbols
export const SearchSymbolsResponseSchema = z.object({
  results: z.array(
    z.object({
      node: NodeSchema,
      matchScore: z.number(),
      matchedField: z.enum(["label", "qualifiedName"]),
    }),
  ),
  totalMatches: z.number(),
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// Sprint 3 — New Query Response Schemas
// ---------------------------------------------------------------------------

// Sprint 3: Get Circular Dependencies (Track 2)
export const CircularDepsResponseSchema = z.object({
  cycles: z.array(
    z.object({
      chain: z.array(z.string()),
      length: z.number(),
    }),
  ),
  totalFilesScanned: z.number(),
  truncated: z.boolean(),
});

// Sprint 3: Get Complexity Metrics (Track 3)
export const ComplexityMetricsResponseSchema = z.object({
  metrics: z.array(
    z.object({
      node: NodeSchema,
      fanIn: z.number(),
      fanOut: z.number(),
      maxDepth: z.number(),
      totalComplexity: z.number(),
    }),
  ),
  totalScanned: z.number(),
  truncated: z.boolean(),
});

// Sprint 3: Get Change Risk (Track 4)
export const ChangeRiskResponseSchema = z.object({
  changedFiles: z.array(z.string()),
  aggregateRiskScore: z.number(),
  affectedFiles: z.array(
    z.object({
      filePath: z.string(),
      depth: z.number(),
      impactType: z.enum(["direct", "transitive"]),
      riskContribution: z.number(),
    }),
  ),
  suggestedTestFiles: z.array(z.string()),
  hotspotOverlap: z.array(
    z.object({
      node: NodeSchema,
      fanIn: z.number(),
    }),
  ),
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------
export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Graph = z.infer<typeof GraphSchema>;
export type FunctionContext = z.infer<typeof FunctionContextSchema>;
export type FileDependency = z.infer<typeof FileDependencySchema>;
export type FileDependents = z.infer<typeof FileDependentsSchema>;
export type SymbolReference = z.infer<typeof SymbolReferenceSchema>;
export type SymbolReferences = z.infer<typeof SymbolReferencesSchema>;
export type CallersResponse = z.infer<typeof CallersResponseSchema>;
export type CallChainResponse = z.infer<typeof CallChainResponseSchema>;
export type DeadCodeResponse = z.infer<typeof DeadCodeResponseSchema>;
export type ImpactAnalysisResponse = z.infer<typeof ImpactAnalysisResponseSchema>;
export type ModuleCouplingResponse = z.infer<typeof ModuleCouplingResponseSchema>;
export type HotspotsResponse = z.infer<typeof HotspotsResponseSchema>;
export type ClassHierarchyResponse = z.infer<typeof ClassHierarchyResponseSchema>;
export type SearchSymbolsResponse = z.infer<typeof SearchSymbolsResponseSchema>;
export type CircularDepsResponse = z.infer<typeof CircularDepsResponseSchema>;
export type ComplexityMetricsResponse = z.infer<typeof ComplexityMetricsResponseSchema>;
export type ChangeRiskResponse = z.infer<typeof ChangeRiskResponseSchema>;
