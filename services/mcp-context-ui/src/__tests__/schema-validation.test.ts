import { describe, it, expect } from "vitest";
import {
  GraphSchema,
  FunctionContextSchema,
  FileDependentsSchema,
  SymbolReferencesSchema,
  NodeSchema,
} from "../types/mcp";
import { ClusterSchema } from "../types/globe";

// ---------------------------------------------------------------------------
// Helpers — reusable minimal payloads
// ---------------------------------------------------------------------------

const validNode = {
  id: "file:backend/app/main.py",
  type: "file" as const,
  label: "main.py",
  filePath: "backend/app/main.py",
};

const validEdge = {
  source: "file:a.py",
  target: "file:b.py",
  type: "imports" as const,
};

// ---------------------------------------------------------------------------
// Issue #3 — GraphSchema accepts optional `meta`
// ---------------------------------------------------------------------------
describe("GraphSchema (Issue #3 — meta field)", () => {
  it("accepts a graph WITHOUT meta", () => {
    const payload = { nodes: [validNode], edges: [validEdge] };
    const result = GraphSchema.parse(payload);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    expect(result.meta).toBeUndefined();
  });

  it("accepts a graph WITH meta", () => {
    const payload = {
      nodes: [validNode],
      edges: [validEdge],
      meta: {
        generatedAt: "2026-04-30T00:00:00Z",
        scope: "repo",
        truncated: false,
        nodeCount: 1,
        edgeCount: 1,
      },
    };
    const result = GraphSchema.parse(payload);
    expect(result.meta).toBeDefined();
    expect(result.meta!.truncated).toBe(false);
    expect(result.meta!.nodeCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Issue #4 — ClusterSchema hex color validation
// ---------------------------------------------------------------------------
describe("ClusterSchema (Issue #4 — hex color validation)", () => {
  it("accepts a valid hex color", () => {
    const payload = { id: "backend", path: "backend/", label: "Backend", color: "#4A90E2" };
    const result = ClusterSchema.parse(payload);
    expect(result.color).toBe("#4A90E2");
  });

  it("accepts lowercase hex color", () => {
    const payload = { id: "fe", path: "frontend/", label: "Frontend", color: "#e24a4a" };
    const result = ClusterSchema.parse(payload);
    expect(result.color).toBe("#e24a4a");
  });

  it("rejects a non-hex color string", () => {
    const payload = { id: "bad", path: "x/", label: "Bad", color: "not-a-hex" };
    expect(() => ClusterSchema.parse(payload)).toThrow();
  });

  it("rejects a short hex color (#FFF)", () => {
    const payload = { id: "short", path: "x/", label: "Short", color: "#FFF" };
    expect(() => ClusterSchema.parse(payload)).toThrow();
  });

  it("rejects hex color without # prefix", () => {
    const payload = { id: "no-hash", path: "x/", label: "No Hash", color: "4A90E2" };
    expect(() => ClusterSchema.parse(payload)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Issue #5 — FunctionContextSchema accepts relatedFiles, truncated, nullable centerNode
// ---------------------------------------------------------------------------
describe("FunctionContextSchema (Issue #5 — relatedFiles & truncated)", () => {
  it("accepts a payload with centerNode, relatedFiles, and truncated", () => {
    const payload = {
      nodes: [validNode],
      edges: [validEdge],
      centerNode: validNode,
      relatedFiles: ["backend/app/config.py"],
      truncated: true,
    };
    const result = FunctionContextSchema.parse(payload);
    expect(result.relatedFiles).toEqual(["backend/app/config.py"]);
    expect(result.truncated).toBe(true);
  });

  it("accepts a payload without relatedFiles and truncated (backward compat)", () => {
    const payload = {
      nodes: [validNode],
      edges: [validEdge],
      centerNode: validNode,
    };
    const result = FunctionContextSchema.parse(payload);
    expect(result.relatedFiles).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });

  it("accepts centerNode: null (Issue #8 pattern — backend returns null when root not found)", () => {
    const payload = {
      nodes: [],
      edges: [],
      centerNode: null,
    };
    const result = FunctionContextSchema.parse(payload);
    expect(result.centerNode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue #6 — FileDependentsSchema accepts optional `summary`
// ---------------------------------------------------------------------------
describe("FileDependentsSchema (Issue #6 — summary field)", () => {
  it("accepts a payload WITH summary", () => {
    const payload = {
      files: ["backend/app/config.py"],
      dependencies: [
        { filePath: "backend/app/config.py", dependencyType: "incoming" },
      ],
      summary: { incomingCount: 3, outgoingCount: 1, truncated: false },
    };
    const result = FileDependentsSchema.parse(payload);
    expect(result.summary).toBeDefined();
    expect(result.summary!.incomingCount).toBe(3);
    expect(result.summary!.outgoingCount).toBe(1);
    expect(result.summary!.truncated).toBe(false);
  });

  it("accepts a payload WITHOUT summary (backward compat)", () => {
    const payload = {
      files: ["backend/app/config.py"],
      dependencies: [
        { filePath: "backend/app/config.py", dependencyType: "outgoing" },
      ],
    };
    const result = FileDependentsSchema.parse(payload);
    expect(result.summary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Issues #7 & #8 — SymbolReferencesSchema: nullable symbol + optional truncated
// ---------------------------------------------------------------------------
describe("SymbolReferencesSchema (Issues #7 & #8 — nullable symbol, truncated)", () => {
  it("accepts symbol: null without throwing (Issue #8 — critical fix)", () => {
    const payload = {
      symbol: null,
      references: [],
    };
    const result = SymbolReferencesSchema.parse(payload);
    expect(result.symbol).toBeNull();
    expect(result.references).toEqual([]);
  });

  it("accepts a valid symbol with truncated: true (Issue #7)", () => {
    const payload = {
      symbol: validNode,
      references: [
        {
          filePath: "backend/app/main.py",
          line: 42,
          column: 10,
          referenceType: "call",
          context: "main()",
        },
      ],
      truncated: true,
    };
    const result = SymbolReferencesSchema.parse(payload);
    expect(result.symbol).toBeDefined();
    expect(result.truncated).toBe(true);
  });

  it("accepts a payload without truncated (backward compat)", () => {
    const payload = {
      symbol: validNode,
      references: [],
    };
    const result = SymbolReferencesSchema.parse(payload);
    expect(result.truncated).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NodeSchema.passthrough() — preserves globe extension fields
// ---------------------------------------------------------------------------
describe("NodeSchema passthrough (globe extension fields)", () => {
  it("preserves lat, lng, clusterId fields", () => {
    const payload = {
      ...validNode,
      lat: 15.0,
      lng: -60.0,
      clusterId: "backend",
    };
    const result = NodeSchema.parse(payload);
    expect((result as Record<string, unknown>).lat).toBe(15.0);
    expect((result as Record<string, unknown>).lng).toBe(-60.0);
    expect((result as Record<string, unknown>).clusterId).toBe("backend");
  });
});


// ---------------------------------------------------------------------------
// Sprint 2 Track 5 — EdgeSchema accepts "inherits" edge type
// ---------------------------------------------------------------------------
import {
  EdgeSchema,
  CallersResponseSchema,
  CallChainResponseSchema,
  DeadCodeResponseSchema,
  ImpactAnalysisResponseSchema,
  ModuleCouplingResponseSchema,
  HotspotsResponseSchema,
  ClassHierarchyResponseSchema,
  SearchSymbolsResponseSchema,
} from "../types/mcp";

describe("EdgeSchema (Track 5 — inherits edge type)", () => {
  it("accepts 'inherits' as a valid edge type", () => {
    const payload = {
      source: "class:Child",
      target: "class:Parent",
      type: "inherits" as const,
    };
    const result = EdgeSchema.parse(payload);
    expect(result.type).toBe("inherits");
  });
});

// ---------------------------------------------------------------------------
// Sprint 1 + Sprint 2 — New Response Schema Validation
// ---------------------------------------------------------------------------

describe("CallersResponseSchema", () => {
  it("parses a valid callers response", () => {
    const payload = {
      target: { id: "fn:create_app", type: "function", label: "create_app", filePath: "main.py" },
      callers: [
        { node: { id: "fn:bootstrap", type: "function", label: "bootstrap" }, depth: 1 },
      ],
      truncated: false,
    };
    const result = CallersResponseSchema.parse(payload);
    expect(result.callers).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });
});

describe("CallChainResponseSchema", () => {
  it("parses a valid call chain response", () => {
    const payload = {
      root: { id: "fn:main", type: "function", label: "main" },
      chain: { nodes: [{ id: "fn:main", type: "function", label: "main" }], edges: [] },
      truncated: false,
    };
    const result = CallChainResponseSchema.parse(payload);
    expect(result.root).not.toBeNull();
    expect(result.chain.nodes).toHaveLength(1);
  });
});

describe("DeadCodeResponseSchema", () => {
  it("parses a valid dead code response", () => {
    const payload = {
      deadSymbols: [
        { node: { id: "fn:unused", type: "function", label: "unused_helper" }, definedIn: "src/utils.ts" },
      ],
      totalScanned: 42,
      truncated: false,
    };
    const result = DeadCodeResponseSchema.parse(payload);
    expect(result.deadSymbols).toHaveLength(1);
    expect(result.totalScanned).toBe(42);
  });
});

describe("ImpactAnalysisResponseSchema", () => {
  it("parses a valid impact analysis response", () => {
    const payload = {
      sourceFile: "backend/app/database.py",
      affectedFiles: [
        { filePath: "backend/app/main.py", depth: 1, impactType: "direct" as const },
      ],
      affectedSymbols: [{ id: "fn:create_app", type: "function", label: "create_app" }],
      riskScore: 0.65,
      suggestedTestFiles: ["backend/tests/test_database.py"],
      truncated: false,
    };
    const result = ImpactAnalysisResponseSchema.parse(payload);
    expect(result.riskScore).toBe(0.65);
    expect(result.affectedFiles).toHaveLength(1);
  });
});

describe("ModuleCouplingResponseSchema", () => {
  it("parses a valid module coupling response", () => {
    const payload = {
      filePathA: "src/a.ts",
      filePathB: "src/b.ts",
      sharedImports: 3,
      sharedSymbols: 5,
      directEdges: 2,
      transitiveEdges: 4,
      couplingScore: 0.42,
      truncated: false,
    };
    const result = ModuleCouplingResponseSchema.parse(payload);
    expect(result.couplingScore).toBe(0.42);
    expect(result.sharedImports).toBe(3);
  });
});

describe("HotspotsResponseSchema", () => {
  it("parses a valid hotspots response", () => {
    const payload = {
      hotspots: [
        {
          node: { id: "fn:render", type: "function", label: "render" },
          fanIn: 25,
          fanOut: 3,
          edgeBreakdown: { calls: 20, references: 5 },
        },
      ],
      totalSymbolsScanned: 150,
      truncated: false,
    };
    const result = HotspotsResponseSchema.parse(payload);
    expect(result.hotspots).toHaveLength(1);
    expect(result.hotspots[0].fanIn).toBe(25);
    expect(result.hotspots[0].edgeBreakdown).toEqual({ calls: 20, references: 5 });
  });
});

describe("ClassHierarchyResponseSchema", () => {
  it("parses a valid class hierarchy response", () => {
    const payload = {
      root: { id: "class:Animal", type: "class", label: "Animal" },
      ancestors: [],
      descendants: [
        { node: { id: "class:Dog", type: "class", label: "Dog" }, depth: 1 },
      ],
      hierarchy: {
        nodes: [
          { id: "class:Animal", type: "class", label: "Animal" },
          { id: "class:Dog", type: "class", label: "Dog" },
        ],
        edges: [
          { source: "class:Dog", target: "class:Animal", type: "inherits" },
        ],
      },
      truncated: false,
    };
    const result = ClassHierarchyResponseSchema.parse(payload);
    expect(result.descendants).toHaveLength(1);
    expect(result.hierarchy.edges).toHaveLength(1);
    expect(result.hierarchy.edges[0].type).toBe("inherits");
  });
});

describe("SearchSymbolsResponseSchema", () => {
  it("parses a valid search symbols response", () => {
    const payload = {
      results: [
        {
          node: { id: "fn:createApp", type: "function", label: "createApp" },
          matchScore: 1.0,
          matchedField: "label" as const,
        },
      ],
      totalMatches: 1,
      truncated: false,
    };
    const result = SearchSymbolsResponseSchema.parse(payload);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].matchScore).toBe(1.0);
    expect(result.results[0].matchedField).toBe("label");
  });
});

// ---------------------------------------------------------------------------
// Sprint 3 — New Response Schema Validation
// ---------------------------------------------------------------------------

import {
  CircularDepsResponseSchema,
  ComplexityMetricsResponseSchema,
  ChangeRiskResponseSchema,
} from "../types/mcp";

describe("CircularDepsResponseSchema", () => {
  it("parses a valid circular deps response with cycles", () => {
    const payload = {
      cycles: [
        { chain: ["a.py", "b.py", "a.py"], length: 2 },
        { chain: ["x.ts", "y.ts", "z.ts", "x.ts"], length: 3 },
      ],
      totalFilesScanned: 150,
      truncated: false,
    };
    const result = CircularDepsResponseSchema.parse(payload);
    expect(result.cycles).toHaveLength(2);
    expect(result.cycles[0].chain).toEqual(["a.py", "b.py", "a.py"]);
    expect(result.cycles[0].length).toBe(2);
    expect(result.totalFilesScanned).toBe(150);
    expect(result.truncated).toBe(false);
  });

  it("parses a valid response with no cycles (DAG)", () => {
    const payload = {
      cycles: [],
      totalFilesScanned: 42,
      truncated: false,
    };
    const result = CircularDepsResponseSchema.parse(payload);
    expect(result.cycles).toHaveLength(0);
    expect(result.totalFilesScanned).toBe(42);
  });

  it("rejects a malformed response (missing required fields)", () => {
    const payload = { cycles: [] };
    expect(() => CircularDepsResponseSchema.parse(payload)).toThrow();
  });

  it("rejects a cycle with invalid chain type", () => {
    const payload = {
      cycles: [{ chain: [123], length: 1 }],
      totalFilesScanned: 1,
      truncated: false,
    };
    expect(() => CircularDepsResponseSchema.parse(payload)).toThrow();
  });
});

describe("ComplexityMetricsResponseSchema", () => {
  it("parses a valid complexity metrics response", () => {
    const payload = {
      metrics: [
        {
          node: { id: "fn:render", type: "function", label: "render", filePath: "src/app.ts" },
          fanIn: 10,
          fanOut: 5,
          maxDepth: 3,
          totalComplexity: 18,
        },
      ],
      totalScanned: 200,
      truncated: false,
    };
    const result = ComplexityMetricsResponseSchema.parse(payload);
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].fanIn).toBe(10);
    expect(result.metrics[0].fanOut).toBe(5);
    expect(result.metrics[0].maxDepth).toBe(3);
    expect(result.metrics[0].totalComplexity).toBe(18);
    expect(result.totalScanned).toBe(200);
  });

  it("parses a valid response with empty metrics", () => {
    const payload = {
      metrics: [],
      totalScanned: 0,
      truncated: false,
    };
    const result = ComplexityMetricsResponseSchema.parse(payload);
    expect(result.metrics).toHaveLength(0);
  });

  it("rejects a malformed response (missing totalScanned)", () => {
    const payload = {
      metrics: [],
      truncated: false,
    };
    expect(() => ComplexityMetricsResponseSchema.parse(payload)).toThrow();
  });

  it("rejects a metric with invalid node (missing required fields)", () => {
    const payload = {
      metrics: [
        {
          node: { id: "fn:bad" },
          fanIn: 1,
          fanOut: 1,
          maxDepth: 1,
          totalComplexity: 3,
        },
      ],
      totalScanned: 1,
      truncated: false,
    };
    expect(() => ComplexityMetricsResponseSchema.parse(payload)).toThrow();
  });
});

describe("ChangeRiskResponseSchema", () => {
  it("parses a valid change risk response", () => {
    const payload = {
      changedFiles: ["backend/app/main.py"],
      aggregateRiskScore: 0.65,
      affectedFiles: [
        { filePath: "backend/app/config.py", depth: 1, impactType: "direct" as const, riskContribution: 0.3 },
        { filePath: "backend/app/routers/users.py", depth: 2, impactType: "transitive" as const, riskContribution: 0.1 },
      ],
      suggestedTestFiles: ["backend/tests/test_main.py"],
      hotspotOverlap: [
        {
          node: { id: "fn:create_app", type: "function", label: "create_app", filePath: "backend/app/main.py" },
          fanIn: 25,
        },
      ],
      truncated: false,
    };
    const result = ChangeRiskResponseSchema.parse(payload);
    expect(result.changedFiles).toEqual(["backend/app/main.py"]);
    expect(result.aggregateRiskScore).toBe(0.65);
    expect(result.affectedFiles).toHaveLength(2);
    expect(result.affectedFiles[0].impactType).toBe("direct");
    expect(result.suggestedTestFiles).toHaveLength(1);
    expect(result.hotspotOverlap).toHaveLength(1);
    expect(result.hotspotOverlap[0].fanIn).toBe(25);
  });

  it("parses a valid response with no affected files", () => {
    const payload = {
      changedFiles: ["nonexistent.py"],
      aggregateRiskScore: 0,
      affectedFiles: [],
      suggestedTestFiles: [],
      hotspotOverlap: [],
      truncated: false,
    };
    const result = ChangeRiskResponseSchema.parse(payload);
    expect(result.affectedFiles).toHaveLength(0);
    expect(result.aggregateRiskScore).toBe(0);
  });

  it("rejects a malformed response (missing changedFiles)", () => {
    const payload = {
      aggregateRiskScore: 0.5,
      affectedFiles: [],
      suggestedTestFiles: [],
      hotspotOverlap: [],
      truncated: false,
    };
    expect(() => ChangeRiskResponseSchema.parse(payload)).toThrow();
  });

  it("rejects an affected file with invalid impactType", () => {
    const payload = {
      changedFiles: ["a.py"],
      aggregateRiskScore: 0.1,
      affectedFiles: [
        { filePath: "b.py", depth: 1, impactType: "unknown", riskContribution: 0.1 },
      ],
      suggestedTestFiles: [],
      hotspotOverlap: [],
      truncated: false,
    };
    expect(() => ChangeRiskResponseSchema.parse(payload)).toThrow();
  });
});
