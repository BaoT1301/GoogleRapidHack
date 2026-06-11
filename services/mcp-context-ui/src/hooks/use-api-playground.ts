/**
 * API Playground Hook
 *
 * State management for the interactive API playground:
 * - Selected endpoint
 * - Parameter values
 * - Loading/error state
 * - Response data
 * - Request history (sessionStorage)
 */

import { useState, useCallback, useMemo } from "react";
import axios from "axios";
import type { EndpointDef } from "../lib/openapi-parser";
import { generateAllSnippets, type CodeSnippets } from "../lib/code-generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaygroundResponse {
  status: number;
  statusText: string;
  data: Record<string, unknown> | unknown[] | string | null;
  headers: Record<string, string>;
  duration: number;
}

export interface HistoryEntry {
  endpointId: string;
  method: string;
  path: string;
  params: Record<string, string>;
  timestamp: number;
}

interface PlaygroundState {
  selectedEndpoint: EndpointDef | null;
  params: Record<string, string>;
  isLoading: boolean;
  response: PlaygroundResponse | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_KEY = "mcp-api-playground-history";
const MAX_HISTORY = 10;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useApiPlayground() {
  const [state, setState] = useState<PlaygroundState>({
    selectedEndpoint: null,
    params: {},
    isLoading: false,
    response: null,
    error: null,
  });

  /**
   * Select an endpoint and reset params to defaults.
   */
  const selectEndpoint = useCallback((endpoint: EndpointDef) => {
    const defaults: Record<string, string> = {};

    // Set defaults from parameters
    for (const param of endpoint.parameters) {
      if (param.schema.default !== undefined) {
        defaults[param.name] = String(param.schema.default);
      }
    }

    // Set defaults from request body
    if (endpoint.requestBody) {
      for (const [key, schema] of Object.entries(endpoint.requestBody.properties)) {
        if (schema.default !== undefined) {
          defaults[key] = String(schema.default);
        }
      }
      // Use example values if available
      if (endpoint.requestBody.example) {
        for (const [key, value] of Object.entries(endpoint.requestBody.example)) {
          if (Array.isArray(value)) {
            defaults[key] = value.join(", ");
          } else {
            defaults[key] = String(value);
          }
        }
      }
    }

    setState({
      selectedEndpoint: endpoint,
      params: defaults,
      isLoading: false,
      response: null,
      error: null,
    });
  }, []);

  /**
   * Update a single parameter value.
   */
  const setParam = useCallback((name: string, value: string) => {
    setState((prev) => ({
      ...prev,
      params: { ...prev.params, [name]: value },
    }));
  }, []);

  /**
   * Execute the request against the live API.
   */
  const executeRequest = useCallback(async () => {
    if (!state.selectedEndpoint) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null, response: null }));

    const endpoint = state.selectedEndpoint;
    const params = state.params;

    // Build URL with path params replaced
    let path = endpoint.path;
    const pathParamRegex = /\{(\w+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pathParamRegex.exec(endpoint.path)) !== null) {
      const paramName = match[1];
      const value = params[paramName] ?? "";
      path = path.replace(`{${paramName}}`, encodeURIComponent(value));
    }

    // Build query params
    const queryParams: Record<string, string> = {};
    for (const param of endpoint.parameters) {
      if (param.in === "query" && params[param.name]) {
        queryParams[param.name] = params[param.name];
      }
    }

    // Build request body
    let body: Record<string, unknown> | undefined;
    if (endpoint.requestBody) {
      body = {};
      for (const [key, schema] of Object.entries(endpoint.requestBody.properties)) {
        const value = params[key];
        if (value === undefined || value === "") continue;

        if (schema.type === "integer" || schema.type === "number") {
          body[key] = Number(value);
        } else if (schema.type === "boolean") {
          body[key] = value === "true";
        } else if (schema.type === "array") {
          body[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
        } else {
          body[key] = value;
        }
      }
      if (Object.keys(body).length === 0) body = undefined;
    }

    const startTime = performance.now();

    try {
      const response = await axios({
        method: endpoint.method.toLowerCase(),
        url: path,
        params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
        data: body,
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true, // Don't throw on non-2xx
      });

      const duration = Math.round(performance.now() - startTime);

      const responseHeaders: Record<string, string> = {};
      if (response.headers) {
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === "string") {
            responseHeaders[key] = value;
          }
        }
      }

      setState((prev) => ({
        ...prev,
        isLoading: false,
        response: {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
          headers: responseHeaders,
          duration,
        },
      }));

      // Save to history
      saveToHistory({
        endpointId: endpoint.id,
        method: endpoint.method,
        path: endpoint.path,
        params,
        timestamp: Date.now(),
      });
    } catch (err) {
      const duration = Math.round(performance.now() - startTime);
      const message = err instanceof Error ? err.message : "Request failed";

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
        response: {
          status: 0,
          statusText: "Network Error",
          data: null,
          headers: {},
          duration,
        },
      }));
    }
  }, [state.selectedEndpoint, state.params]);

  /**
   * Generate code snippets for the current endpoint and params.
   */
  const codeSnippets: CodeSnippets | null = useMemo(() => {
    if (!state.selectedEndpoint) return null;
    return generateAllSnippets(state.selectedEndpoint, state.params);
  }, [state.selectedEndpoint, state.params]);

  /**
   * Get request history from sessionStorage.
   */
  const getHistory = useCallback((): HistoryEntry[] => {
    try {
      const raw = sessionStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, []);

  /**
   * Clear the response state.
   */
  const clearResponse = useCallback(() => {
    setState((prev) => ({ ...prev, response: null, error: null }));
  }, []);

  return {
    selectedEndpoint: state.selectedEndpoint,
    params: state.params,
    isLoading: state.isLoading,
    response: state.response,
    error: state.error,
    codeSnippets,
    selectEndpoint,
    setParam,
    executeRequest,
    clearResponse,
    getHistory,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function saveToHistory(entry: HistoryEntry): void {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    const history: HistoryEntry[] = raw ? JSON.parse(raw) : [];
    history.unshift(entry);
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // Silently fail if sessionStorage is unavailable
  }
}
