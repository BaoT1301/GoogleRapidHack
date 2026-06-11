/**
 * EndpointSidebar — Left sidebar listing all API endpoints grouped by category.
 *
 * Features:
 * - Grouped by OpenAPI tags (collapsible accordion)
 * - HTTP method badge (GET/POST)
 * - Filter input for searching endpoints
 * - Active endpoint highlighting
 */

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/utils";
import type { EndpointDef, EndpointGroup } from "../../lib/openapi-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EndpointSidebarProps {
  groups: EndpointGroup[];
  activeEndpointId: string | null;
  onSelectEndpoint: (endpoint: EndpointDef) => void;
}

// ---------------------------------------------------------------------------
// Method badge colors
// ---------------------------------------------------------------------------

function getMethodColor(method: string): string {
  switch (method) {
    case "GET":
      return "bg-emerald-100 text-emerald-700";
    case "POST":
      return "bg-blue-100 text-blue-700";
    case "PUT":
      return "bg-amber-100 text-amber-700";
    case "DELETE":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EndpointSidebar({
  groups,
  activeEndpointId,
  onSelectEndpoint,
}: EndpointSidebarProps) {
  const [filter, setFilter] = useState("");

  const filteredGroups = useMemo(() => {
    if (!filter.trim()) return groups;

    const query = filter.toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        endpoints: group.endpoints.filter(
          (ep) =>
            ep.summary.toLowerCase().includes(query) ||
            ep.path.toLowerCase().includes(query) ||
            ep.description.toLowerCase().includes(query)
        ),
      }))
      .filter((group) => group.endpoints.length > 0);
  }, [groups, filter]);

  return (
    <div className="flex flex-col h-full border-r border-slate-200 bg-white">
      {/* Filter input */}
      <div className="p-3 border-b border-slate-200">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Filter endpoints..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Endpoint list */}
      <ScrollArea className="flex-1">
        <div className="py-2">
          {filteredGroups.map((group) => (
            <div key={group.tag} className="mb-1">
              {/* Group header */}
              <div className="px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {group.tag}
                </span>
              </div>

              {/* Endpoints in group */}
              {group.endpoints.map((endpoint) => (
                <button
                  key={endpoint.id}
                  onClick={() => onSelectEndpoint(endpoint)}
                  className={cn(
                    "w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-slate-50 transition-colors",
                    activeEndpointId === endpoint.id && "bg-primary-50 border-r-2 border-primary-600"
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5",
                      getMethodColor(endpoint.method)
                    )}
                  >
                    {endpoint.method}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-700 truncate">
                      {endpoint.summary}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate font-mono">
                      {endpoint.path}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ))}

          {filteredGroups.length === 0 && (
            <div className="px-3 py-8 text-center">
              <p className="text-xs text-slate-400">No endpoints match your filter.</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-slate-200">
        <Badge variant="secondary" className="text-[10px]">
          {groups.reduce((acc, g) => acc + g.endpoints.length, 0)} endpoints
        </Badge>
      </div>
    </div>
  );
}
