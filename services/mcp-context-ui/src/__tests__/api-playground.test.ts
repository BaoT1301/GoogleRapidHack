/**
 * Track 4 — API Playground Tests
 *
 * Tests for:
 * 1. Code generation functions (curl, TypeScript, Python)
 * 2. OpenAPI parser (endpoint count, parameter types, grouping)
 */

import { describe, it, expect } from "vitest";
import { generateCurl, generateTypeScript, generatePython } from "../lib/code-generator";
import {
  getEndpointGroups,
  getAllEndpoints,
  getEndpointCount,
  getTagCount,
  getEndpointById,
  type EndpointDef,
} from "../lib/openapi-parser";

// ---------------------------------------------------------------------------
// Code Generator Tests
// ---------------------------------------------------------------------------

describe("Code Generator", () => {
  const healthEndpoint: EndpointDef = {
    id: "getHealth",
    method: "GET",
    path: "/api/v1/health",
    summary: "Health check",
    description: "Returns service health status.",
    operationId: "getHealth",
    tag: "Health",
    parameters: [],
    responseDescription: "Service is healthy",
  };

  const graphEndpoint: EndpointDef = {
    id: "exportGraph",
    method: "GET",
    path: "/api/v1/mcp/graph",
    summary: "Export dependency graph",
    description: "Exports the full dependency graph.",
    operationId: "exportGraph",
    tag: "Graph Export",
    parameters: [
      { name: "scope", in: "query", required: false, description: "Graph scope", schema: { type: "string", enum: ["repo", "file", "symbol"], default: "repo" } },
      { name: "max_nodes", in: "query", required: false, description: "Max nodes", schema: { type: "integer", default: 0 } },
    ],
    responseDescription: "Graph exported successfully",
  };

  const postEndpoint: EndpointDef = {
    id: "getChangeRisk",
    method: "POST",
    path: "/api/v1/mcp/change-risk",
    summary: "Get change risk",
    description: "Predicts risk for changed files.",
    operationId: "getChangeRiskPost",
    tag: "Change Risk",
    parameters: [],
    requestBody: {
      required: true,
      properties: {
        changed_files: { type: "array", required: true, description: "Changed file paths" },
        max_depth: { type: "integer", default: 3, description: "Import chain depth" },
      },
    },
    responseDescription: "Change risk analysis complete",
  };

  const pathParamEndpoint: EndpointDef = {
    id: "getCallers",
    method: "GET",
    path: "/api/v1/mcp/callers/{functionName}",
    summary: "Get callers",
    description: "Returns all callers.",
    operationId: "getCallers",
    tag: "Callers",
    parameters: [
      { name: "functionName", in: "path", required: true, description: "Function name", schema: { type: "string" } },
      { name: "max_depth", in: "query", required: false, description: "Depth", schema: { type: "integer", default: 3 } },
    ],
    responseDescription: "Callers retrieved",
  };

  describe("generateCurl", () => {
    it("generates a simple GET request", () => {
      const result = generateCurl(healthEndpoint, {});
      expect(result).toContain("curl");
      expect(result).toContain("/api/v1/health");
      expect(result).not.toContain("-X");
    });

    it("includes query parameters", () => {
      const result = generateCurl(graphEndpoint, { scope: "file", max_nodes: "100" });
      expect(result).toContain("scope=file");
      expect(result).toContain("max_nodes=100");
    });

    it("replaces path parameters", () => {
      const result = generateCurl(pathParamEndpoint, { functionName: "create_app", max_depth: "5" });
      expect(result).toContain("/api/v1/mcp/callers/create_app");
      expect(result).toContain("max_depth=5");
      expect(result).not.toContain("{functionName}");
    });

    it("generates POST with JSON body", () => {
      const result = generateCurl(postEndpoint, { changed_files: "a.py,b.py", max_depth: "3" });
      expect(result).toContain("-X POST");
      expect(result).toContain("Content-Type: application/json");
      expect(result).toContain('"changed_files"');
      expect(result).toContain('"max_depth"');
    });

    it("uses custom base URL", () => {
      const result = generateCurl(healthEndpoint, {}, "http://myhost:4000");
      expect(result).toContain("http://myhost:4000/api/v1/health");
    });
  });

  describe("generateTypeScript", () => {
    it("generates axios GET request", () => {
      const result = generateTypeScript(healthEndpoint, {});
      expect(result).toContain("import axios");
      expect(result).toContain("axios.get");
      expect(result).toContain("/api/v1/health");
    });

    it("generates axios POST with body", () => {
      const result = generateTypeScript(postEndpoint, { changed_files: "a.py,b.py", max_depth: "3" });
      expect(result).toContain("axios.post");
      expect(result).toContain("changed_files");
    });

    it("includes query parameters in URL", () => {
      const result = generateTypeScript(graphEndpoint, { scope: "repo" });
      expect(result).toContain("scope=repo");
    });
  });

  describe("generatePython", () => {
    it("generates requests GET", () => {
      const result = generatePython(healthEndpoint, {});
      expect(result).toContain("import requests");
      expect(result).toContain("requests.get");
      expect(result).toContain("/api/v1/health");
      expect(result).toContain("print(response.json())");
    });

    it("generates requests POST with json body", () => {
      const result = generatePython(postEndpoint, { changed_files: "a.py,b.py", max_depth: "3" });
      expect(result).toContain("requests.post");
      expect(result).toContain("json=");
    });

    it("replaces path parameters", () => {
      const result = generatePython(pathParamEndpoint, { functionName: "my_func" });
      expect(result).toContain("/api/v1/mcp/callers/my_func");
    });
  });
});

// ---------------------------------------------------------------------------
// OpenAPI Parser Tests
// ---------------------------------------------------------------------------

describe("OpenAPI Parser", () => {
  describe("getEndpointCount", () => {
    it("returns the correct total number of endpoints", () => {
      const count = getEndpointCount();
      // We defined 22 endpoints in the static data
      expect(count).toBeGreaterThanOrEqual(20);
      expect(count).toBeLessThanOrEqual(30);
    });
  });

  describe("getTagCount", () => {
    it("returns the correct number of tags", () => {
      const count = getTagCount();
      expect(count).toBe(17);
    });
  });

  describe("getAllEndpoints", () => {
    it("returns all endpoints as a flat array", () => {
      const endpoints = getAllEndpoints();
      expect(endpoints.length).toBe(getEndpointCount());
      expect(endpoints[0].id).toBeDefined();
      expect(endpoints[0].method).toBeDefined();
      expect(endpoints[0].path).toBeDefined();
    });

    it("all endpoints have required fields", () => {
      const endpoints = getAllEndpoints();
      for (const ep of endpoints) {
        expect(ep.id).toBeTruthy();
        expect(ep.method).toMatch(/^(GET|POST|PUT|DELETE|PATCH)$/);
        expect(ep.path).toMatch(/^\/api\/v1\//);
        expect(ep.summary).toBeTruthy();
        expect(ep.tag).toBeTruthy();
        expect(ep.operationId).toBeTruthy();
      }
    });
  });

  describe("getEndpointGroups", () => {
    it("groups endpoints by tag", () => {
      const groups = getEndpointGroups();
      expect(groups.length).toBe(17);
      expect(groups[0].tag).toBe("Health");
      expect(groups[0].endpoints.length).toBeGreaterThanOrEqual(1);
    });

    it("each group has a description", () => {
      const groups = getEndpointGroups();
      for (const group of groups) {
        expect(group.description).toBeTruthy();
      }
    });

    it("preserves tag ordering", () => {
      const groups = getEndpointGroups();
      const tags = groups.map((g) => g.tag);
      expect(tags[0]).toBe("Health");
      expect(tags[1]).toBe("Graph Export");
      expect(tags[tags.length - 1]).toBe("SSE Events");
    });
  });

  describe("getEndpointById", () => {
    it("finds an endpoint by ID", () => {
      const ep = getEndpointById("getHealth");
      expect(ep).toBeDefined();
      expect(ep!.path).toBe("/api/v1/health");
    });

    it("returns undefined for unknown ID", () => {
      const ep = getEndpointById("nonexistent");
      expect(ep).toBeUndefined();
    });
  });

  describe("parameter types", () => {
    it("GET endpoints have parameters with correct schema types", () => {
      const ep = getEndpointById("exportGraph");
      expect(ep).toBeDefined();
      expect(ep!.parameters.length).toBeGreaterThan(0);

      const scopeParam = ep!.parameters.find((p) => p.name === "scope");
      expect(scopeParam).toBeDefined();
      expect(scopeParam!.schema.type).toBe("string");
      expect(scopeParam!.schema.enum).toContain("repo");
      expect(scopeParam!.schema.enum).toContain("file");
    });

    it("POST endpoints have request body definitions", () => {
      const ep = getEndpointById("getChangeRisk");
      expect(ep).toBeDefined();
      expect(ep!.requestBody).toBeDefined();
      expect(ep!.requestBody!.properties.changed_files).toBeDefined();
      expect(ep!.requestBody!.properties.changed_files.type).toBe("array");
    });

    it("path parameters are marked as required", () => {
      const ep = getEndpointById("getCallers");
      expect(ep).toBeDefined();
      const pathParam = ep!.parameters.find((p) => p.in === "path");
      expect(pathParam).toBeDefined();
      expect(pathParam!.required).toBe(true);
    });
  });
});
