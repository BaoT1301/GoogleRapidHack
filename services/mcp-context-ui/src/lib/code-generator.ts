/**
 * Code Generator
 *
 * Generates curl, TypeScript, and Python code snippets from endpoint
 * definitions and parameter values for the API playground.
 */

import type { EndpointDef, HttpMethod } from "./openapi-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeSnippets {
  curl: string;
  typescript: string;
  python: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUrl(
  endpoint: EndpointDef,
  params: Record<string, string>,
  baseUrl: string
): string {
  let path = endpoint.path;

  // Replace path parameters
  const pathParamRegex = /\{(\w+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pathParamRegex.exec(endpoint.path)) !== null) {
    const paramName = match[1];
    const value = params[paramName] ?? "";
    path = path.replace(`{${paramName}}`, encodeURIComponent(value));
  }

  // Build query string from non-path params
  const queryParams: string[] = [];
  for (const param of endpoint.parameters) {
    if (param.in === "query" && params[param.name]) {
      queryParams.push(`${param.name}=${encodeURIComponent(params[param.name])}`);
    }
  }

  const queryString = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
  return `${baseUrl}${path}${queryString}`;
}

function buildRequestBody(
  endpoint: EndpointDef,
  params: Record<string, string>
): Record<string, unknown> | null {
  if (!endpoint.requestBody) return null;

  const body: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(endpoint.requestBody.properties)) {
    const value = params[key];
    if (value === undefined || value === "") continue;

    if (schema.type === "integer" || schema.type === "number") {
      body[key] = Number(value);
    } else if (schema.type === "boolean") {
      body[key] = value === "true";
    } else if (schema.type === "array") {
      // Comma-separated → array
      body[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      body[key] = value;
    }
  }

  return Object.keys(body).length > 0 ? body : null;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generate a curl command for the given endpoint and parameters.
 */
export function generateCurl(
  endpoint: EndpointDef,
  params: Record<string, string>,
  baseUrl = "http://localhost:3001"
): string {
  const url = buildUrl(endpoint, params, baseUrl);
  const method = endpoint.method;

  const parts: string[] = ["curl"];

  if (method !== "GET") {
    parts.push(`-X ${method}`);
  }

  const body = buildRequestBody(endpoint, params);
  if (body) {
    parts.push("-H 'Content-Type: application/json'");
    parts.push(`-d '${JSON.stringify(body, null, 2)}'`);
  }

  parts.push(`'${url}'`);

  return parts.join(" \\\n  ");
}

/**
 * Generate TypeScript (axios) code for the given endpoint and parameters.
 */
export function generateTypeScript(
  endpoint: EndpointDef,
  params: Record<string, string>,
  baseUrl = "http://localhost:3001"
): string {
  const url = buildUrl(endpoint, params, baseUrl);
  const method = endpoint.method.toLowerCase() as Lowercase<HttpMethod>;
  const body = buildRequestBody(endpoint, params);

  const lines: string[] = [
    `import axios from 'axios';`,
    ``,
  ];

  if (body) {
    lines.push(`const response = await axios.${method}('${url}', ${JSON.stringify(body, null, 2)});`);
  } else {
    lines.push(`const response = await axios.${method}('${url}');`);
  }

  lines.push(`console.log(response.data);`);

  return lines.join("\n");
}

/**
 * Generate Python (requests) code for the given endpoint and parameters.
 */
export function generatePython(
  endpoint: EndpointDef,
  params: Record<string, string>,
  baseUrl = "http://localhost:3001"
): string {
  const url = buildUrl(endpoint, params, baseUrl);
  const method = endpoint.method.toLowerCase();
  const body = buildRequestBody(endpoint, params);

  const lines: string[] = [
    `import requests`,
    ``,
  ];

  if (body) {
    lines.push(`response = requests.${method}(`);
    lines.push(`    '${url}',`);
    lines.push(`    json=${JSON.stringify(body, null, 4).replace(/null/g, "None").replace(/true/g, "True").replace(/false/g, "False")}`);
    lines.push(`)`);
  } else {
    lines.push(`response = requests.${method}('${url}')`);
  }

  lines.push(`print(response.json())`);

  return lines.join("\n");
}

/**
 * Generate all code snippets for an endpoint.
 */
export function generateAllSnippets(
  endpoint: EndpointDef,
  params: Record<string, string>,
  baseUrl = "http://localhost:3001"
): CodeSnippets {
  return {
    curl: generateCurl(endpoint, params, baseUrl),
    typescript: generateTypeScript(endpoint, params, baseUrl),
    python: generatePython(endpoint, params, baseUrl),
  };
}
