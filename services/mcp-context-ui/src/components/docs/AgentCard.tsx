/**
 * AgentCard — Card displaying an AI agent with logo, name, description, and configure action.
 */
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import type { ReactNode } from "react";

interface AgentCardProps {
  name: string;
  description: string;
  configPath: string;
  icon: ReactNode;
  status?: "supported" | "experimental";
}

export function AgentCard({ name, description, configPath, icon, status = "supported" }: AgentCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-slate-100 text-slate-700">
            {icon}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{name}</CardTitle>
              <Badge variant={status === "supported" ? "success" : "warning"}>
                {status === "supported" ? "Supported" : "Experimental"}
              </Badge>
            </div>
            <CardDescription className="mt-0.5">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium">Config file:</span>
          <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono">
            {configPath}
          </code>
        </div>
      </CardContent>
    </Card>
  );
}
