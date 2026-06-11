/**
 * EndpointDetail — Main area showing endpoint details with parameter forms,
 * "Try It" button, request preview, and live response display.
 */

import { useState } from "react";
import { Play, Loader2, Clock, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { CodeBlock } from "../ui/code-block";
import { cn } from "../../lib/utils";
import type { EndpointDef } from "../../lib/openapi-parser";
import type { PlaygroundResponse } from "../../hooks/use-api-playground";
import type { CodeSnippets } from "../../lib/code-generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EndpointDetailProps {
  endpoint: EndpointDef;
  params: Record<string, string>;
  isLoading: boolean;
  response: PlaygroundResponse | null;
  error: string | null;
  codeSnippets: CodeSnippets | null;
  onParamChange: (name: string, value: string) => void;
  onExecute: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMethodColor(method: string): string {
  switch (method) {
    case "GET":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "POST":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "PUT":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "DELETE":
      return "bg-red-100 text-red-700 border-red-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return "bg-emerald-100 text-emerald-700";
  if (status >= 300 && status < 400) return "bg-amber-100 text-amber-700";
  if (status >= 400 && status < 500) return "bg-orange-100 text-orange-700";
  if (status >= 500) return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-700";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EndpointDetail({
  endpoint,
  params,
  isLoading,
  response,
  error,
  codeSnippets,
  onParamChange,
  onExecute,
}: EndpointDetailProps) {
  const [showHeaders, setShowHeaders] = useState(false);
  const [codeTab, setCodeTab] = useState<"curl" | "typescript" | "python">("curl");

  const hasPathParams = endpoint.parameters.some((p) => p.in === "path");
  const hasQueryParams = endpoint.parameters.some((p) => p.in === "query");
  const hasBody = !!endpoint.requestBody;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "text-sm font-bold px-2.5 py-1 rounded border",
              getMethodColor(endpoint.method)
            )}
          >
            {endpoint.method}
          </span>
          <code className="text-sm font-mono text-slate-700">{endpoint.path}</code>
        </div>
        <h2 className="text-xl font-semibold text-slate-900">{endpoint.summary}</h2>
        <p className="text-sm text-slate-600">{endpoint.description}</p>
      </div>

      {/* Parameters Section */}
      {(hasPathParams || hasQueryParams || hasBody) && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Parameters</h3>

            {/* Path parameters */}
            {hasPathParams && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Path Parameters</p>
                {endpoint.parameters
                  .filter((p) => p.in === "path")
                  .map((param) => (
                    <ParameterField
                      key={param.name}
                      name={param.name}
                      description={param.description}
                      required={param.required}
                      schema={param.schema}
                      value={params[param.name] ?? ""}
                      onChange={(v) => onParamChange(param.name, v)}
                    />
                  ))}
              </div>
            )}

            {/* Query parameters */}
            {hasQueryParams && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Query Parameters</p>
                {endpoint.parameters
                  .filter((p) => p.in === "query")
                  .map((param) => (
                    <ParameterField
                      key={param.name}
                      name={param.name}
                      description={param.description}
                      required={param.required}
                      schema={param.schema}
                      value={params[param.name] ?? ""}
                      onChange={(v) => onParamChange(param.name, v)}
                    />
                  ))}
              </div>
            )}

            {/* Request body */}
            {hasBody && endpoint.requestBody && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Request Body</p>
                {Object.entries(endpoint.requestBody.properties).map(([key, schema]) => (
                  <ParameterField
                    key={key}
                    name={key}
                    description={schema.description ?? ""}
                    required={!!schema.required}
                    schema={schema}
                    value={params[key] ?? ""}
                    onChange={(v) => onParamChange(key, v)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Try It Button */}
      <div className="flex items-center gap-3">
        <Button onClick={onExecute} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Sending...</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              <span>Try It</span>
            </>
          )}
        </Button>
        {response !== null && response !== undefined && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            <span>{String(response.duration)}ms</span>
          </div>
        )}
      </div>

      {/* Code Examples */}
      {codeSnippets && (
        <Card>
          <CardContent className="p-0">
            <div className="flex border-b border-slate-200">
              {(["curl", "typescript", "python"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCodeTab(tab)}
                  className={cn(
                    "px-4 py-2 text-xs font-medium transition-colors",
                    codeTab === tab
                      ? "text-primary-600 border-b-2 border-primary-600"
                      : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {tab === "curl" ? "cURL" : tab === "typescript" ? "TypeScript" : "Python"}
                </button>
              ))}
            </div>
            <div className="p-0">
              <CodeBlock
                code={codeSnippets[codeTab]}
                language={codeTab === "curl" ? "bash" : codeTab}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Response Section */}
      {(response || error) && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Response</h3>
              {response && response.status > 0 && (
                <div className="flex items-center gap-2">
                  <Badge className={getStatusColor(response.status)}>
                    {response.status} {response.statusText}
                  </Badge>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 rounded-md border border-red-200">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {response && response.data !== null && (
              <CodeBlock
                code={JSON.stringify(response.data, null, 2) ?? "null"}
                language="json"
                title="Response Body"
              />
            )}

            {/* Response headers (collapsible) */}
            {response && Object.keys(response.headers).length > 0 && (
              <div>
                <button
                  onClick={() => setShowHeaders(!showHeaders)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                >
                  {showHeaders ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Response Headers
                </button>
                {showHeaders && (
                  <div className="mt-2 p-3 bg-slate-50 rounded-md text-xs font-mono space-y-1">
                    {Object.entries(response.headers).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-slate-500">{key}:</span>
                        <span className="text-slate-700">{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Example Response (from spec) */}
      {endpoint.responseExample && !response && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Example Response</h3>
            <p className="text-xs text-slate-500">{endpoint.responseDescription}</p>
            <CodeBlock
              code={JSON.stringify(endpoint.responseExample, null, 2)}
              language="json"
              title="200 OK"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ParameterField sub-component
// ---------------------------------------------------------------------------

interface ParameterFieldProps {
  name: string;
  description: string;
  required: boolean;
  schema: {
    type: string;
    enum?: string[];
    default?: string | number | boolean;
    minimum?: number;
    maximum?: number;
  };
  value: string;
  onChange: (value: string) => void;
}

function ParameterField({
  name,
  description,
  required,
  schema,
  value,
  onChange,
}: ParameterFieldProps) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-3 items-start">
      <div className="space-y-0.5 pt-1.5">
        <div className="flex items-center gap-1">
          <span className="text-xs font-mono font-medium text-slate-700">{name}</span>
          {required && <span className="text-red-500 text-xs">*</span>}
        </div>
        <p className="text-[10px] text-slate-400">{description}</p>
        {schema.default !== undefined && (
          <p className="text-[10px] text-slate-400">
            Default: <code className="bg-slate-100 px-1 rounded">{String(schema.default)}</code>
          </p>
        )}
      </div>
      <div>
        {schema.enum ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <option value="">— select —</option>
            {schema.enum.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : schema.type === "boolean" ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <option value="">— select —</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : schema.type === "integer" || schema.type === "number" ? (
          <Input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={schema.default !== undefined ? String(schema.default) : ""}
            min={schema.minimum}
            max={schema.maximum}
            className="h-8 text-xs"
          />
        ) : (
          <Input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={schema.type === "array" ? "comma-separated values" : ""}
            className="h-8 text-xs"
          />
        )}
      </div>
    </div>
  );
}
