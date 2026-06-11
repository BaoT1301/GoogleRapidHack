/**
 * ToolList — Compact list of MCP tools with expand-for-details functionality.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { cn } from "../../lib/utils";

interface MCPTool {
  name: string;
  description: string;
  parameters?: string;
}

interface ToolListProps {
  tools: MCPTool[];
  className?: string;
}

function ToolItem({ tool }: { tool: MCPTool }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="border-b border-slate-100 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 py-2.5 px-3 text-left hover:bg-slate-50 transition-colors rounded-md"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        )}
        <Wrench className="h-3.5 w-3.5 text-primary-500 shrink-0" />
        <code className="text-sm font-mono text-slate-800">{tool.name}</code>
        <span className="text-xs text-slate-500 ml-auto truncate max-w-[50%]">
          {tool.description}
        </span>
      </button>
      {expanded && (
        <div className="pl-10 pr-3 pb-3 text-sm text-slate-600">
          <p>{tool.description}</p>
          {tool.parameters && (
            <p className="mt-1 text-xs text-slate-500">
              <span className="font-medium">Key params:</span> {tool.parameters}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function ToolList({ tools, className }: ToolListProps) {
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white", className)}>
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-lg">
        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wide">
          Available MCP Tools ({tools.length})
        </h4>
      </div>
      <ul className="divide-y divide-slate-100">
        {tools.map((tool) => (
          <ToolItem key={tool.name} tool={tool} />
        ))}
      </ul>
    </div>
  );
}
