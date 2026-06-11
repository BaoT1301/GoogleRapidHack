/**
 * API Reference Page — Interactive API Playground
 *
 * Features:
 * - Left sidebar with all endpoints grouped by category
 * - Main area with endpoint details, parameter forms, "Try It" button
 * - Live response display with status code, timing, and JSON body
 * - Code generation in curl, TypeScript, and Python
 * - Health check gate: shows banner if MCP service is unavailable
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Zap } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { EndpointSidebar } from "../components/api/EndpointSidebar";
import { EndpointDetail } from "../components/api/EndpointDetail";
import { getEndpointGroups, getEndpointCount, getTagCount } from "../lib/openapi-parser";
import { useApiPlayground } from "../hooks/use-api-playground";
import api from "../api/instance";
import { useNavigate } from "react-router-dom";

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

function useHealthCheck() {
  return useQuery({
    queryKey: ["mcp-health"],
    queryFn: async () => {
      const { data } = await api.get("/health");
      return data as { status: string };
    },
    retry: 1,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ApiReferencePage() {
  const navigate = useNavigate();
  const healthQuery = useHealthCheck();
  const isServiceDown = healthQuery.isError;

  const groups = useMemo(() => getEndpointGroups(), []);
  const endpointCount = getEndpointCount();
  const tagCount = getTagCount();

  const {
    selectedEndpoint,
    params,
    isLoading,
    response,
    error,
    codeSnippets,
    selectEndpoint,
    setParam,
    executeRequest,
  } = useApiPlayground();

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Service unavailable banner */}
      {isServiceDown && (
        <div className="flex items-center gap-3 px-6 py-3 bg-amber-50 border-b border-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">
            MCP Context Manager is not reachable. The playground requires a running service to execute requests.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/setup")}
            className="ml-auto shrink-0"
          >
            Go to Setup
          </Button>
        </div>
      )}

      {/* Main layout: sidebar + detail */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — 280px */}
        <div className="w-[280px] shrink-0">
          <EndpointSidebar
            groups={groups}
            activeEndpointId={selectedEndpoint?.id ?? null}
            onSelectEndpoint={selectEndpoint}
          />
        </div>

        {/* Right main area */}
        <div className="flex-1 overflow-y-auto bg-slate-50">
          {selectedEndpoint ? (
            <EndpointDetail
              endpoint={selectedEndpoint}
              params={params}
              isLoading={isLoading}
              response={response}
              error={error}
              codeSnippets={codeSnippets}
              onParamChange={setParam}
              onExecute={executeRequest}
            />
          ) : (
            <EmptyState endpointCount={endpointCount} tagCount={tagCount} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state (no endpoint selected)
// ---------------------------------------------------------------------------

function EmptyState({ endpointCount, tagCount }: { endpointCount: number; tagCount: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center mb-4">
        <BookOpen className="h-6 w-6 text-primary-600" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900 mb-2">API Playground</h2>
      <p className="text-sm text-slate-500 max-w-md mb-4">
        Select an endpoint from the sidebar to view its documentation,
        configure parameters, and execute live requests.
      </p>
      <div className="flex items-center gap-4">
        <Badge variant="secondary">
          <Zap className="h-3 w-3 mr-1" />
          {endpointCount} endpoints
        </Badge>
        <Badge variant="secondary">
          {tagCount} categories
        </Badge>
      </div>
    </div>
  );
}
