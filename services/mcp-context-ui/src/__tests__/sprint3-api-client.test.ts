/**
 * Sprint 3 — API Client Tests
 *
 * Verifies that the three new API client functions (getCircularDeps,
 * getComplexityMetrics, getChangeRisk) are callable and correctly
 * transform parameters to snake_case for the backend.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import api from "../api/instance";
import { getCircularDeps, getComplexityMetrics, getChangeRisk } from "../api/mcp";

// ---------------------------------------------------------------------------
// Mock the axios instance
// ---------------------------------------------------------------------------

vi.mock("../api/instance", () => {
  return {
    default: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

// ---------------------------------------------------------------------------
// Helpers — minimal valid response payloads
// ---------------------------------------------------------------------------

const validCircularDepsResponse = {
  cycles: [{ chain: ["a.py", "b.py", "a.py"], length: 2 }],
  totalFilesScanned: 50,
  truncated: false,
};

const validComplexityMetricsResponse = {
  metrics: [
    {
      node: { id: "fn:render", type: "function", label: "render" },
      fanIn: 10,
      fanOut: 5,
      maxDepth: 3,
      totalComplexity: 18,
    },
  ],
  totalScanned: 100,
  truncated: false,
};

const validChangeRiskResponse = {
  changedFiles: ["backend/app/main.py"],
  aggregateRiskScore: 0.65,
  affectedFiles: [
    { filePath: "backend/app/config.py", depth: 1, impactType: "direct", riskContribution: 0.3 },
  ],
  suggestedTestFiles: ["backend/tests/test_main.py"],
  hotspotOverlap: [
    {
      node: { id: "fn:create_app", type: "function", label: "create_app" },
      fanIn: 25,
    },
  ],
  truncated: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCircularDeps", () => {
  it("calls POST /mcp/circular-deps and returns validated data", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: validCircularDepsResponse });

    const result = await getCircularDeps({ filePattern: "backend/**", language: "python", maxCycles: 10 });

    expect(mockedApi.post).toHaveBeenCalledWith("/mcp/circular-deps", {
      file_pattern: "backend/**",
      language: "python",
      max_cycles: 10,
      max_depth: undefined,
    });
    expect(result.cycles).toHaveLength(1);
    expect(result.totalFilesScanned).toBe(50);
  });

  it("calls with no params (all optional)", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { ...validCircularDepsResponse, cycles: [] } });

    const result = await getCircularDeps();

    expect(mockedApi.post).toHaveBeenCalledWith("/mcp/circular-deps", {
      file_pattern: undefined,
      language: undefined,
      max_cycles: undefined,
      max_depth: undefined,
    });
    expect(result.cycles).toHaveLength(0);
  });
});

describe("getComplexityMetrics", () => {
  it("calls POST /mcp/complexity and returns validated data", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: validComplexityMetricsResponse });

    const result = await getComplexityMetrics({ kind: "function", sortBy: "fan_in", maxResults: 50 });

    expect(mockedApi.post).toHaveBeenCalledWith("/mcp/complexity", {
      file_path: undefined,
      kind: "function",
      language: undefined,
      sort_by: "fan_in",
      max_results: 50,
    });
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].fanIn).toBe(10);
  });

  it("calls with no params (all optional)", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { ...validComplexityMetricsResponse, metrics: [] } });

    const result = await getComplexityMetrics();

    expect(mockedApi.post).toHaveBeenCalledWith("/mcp/complexity", {
      file_path: undefined,
      kind: undefined,
      language: undefined,
      sort_by: undefined,
      max_results: undefined,
    });
    expect(result.metrics).toHaveLength(0);
  });
});

describe("getChangeRisk", () => {
  it("calls POST /mcp/change-risk and returns validated data", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: validChangeRiskResponse });

    const result = await getChangeRisk({ changedFiles: ["backend/app/main.py"], maxDepth: 2 });

    expect(mockedApi.post).toHaveBeenCalledWith("/mcp/change-risk", {
      changed_files: ["backend/app/main.py"],
      max_depth: 2,
      max_files: undefined,
    });
    expect(result.aggregateRiskScore).toBe(0.65);
    expect(result.affectedFiles).toHaveLength(1);
    expect(result.hotspotOverlap).toHaveLength(1);
  });

  it("sends multiple changed files", async () => {
    const multiFileResponse = {
      ...validChangeRiskResponse,
      changedFiles: ["a.py", "b.py", "c.py"],
    };
    mockedApi.post.mockResolvedValueOnce({ data: multiFileResponse });

    const result = await getChangeRisk({ changedFiles: ["a.py", "b.py", "c.py"] });

    expect(mockedApi.post).toHaveBeenCalledWith("/mcp/change-risk", {
      changed_files: ["a.py", "b.py", "c.py"],
      max_depth: undefined,
      max_files: undefined,
    });
    expect(result.changedFiles).toHaveLength(3);
  });
});
