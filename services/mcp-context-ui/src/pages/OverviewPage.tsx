/**
 * Overview page — landing page for the MCP Context Manager documentation portal.
 *
 * Displays: hero section, "What is MCP?" explanation, architecture diagram,
 * feature grid, and quick start CTA.
 */
import { Link } from "react-router-dom";
import {
  Network,
  GitBranch,
  Search,
  FileCode,
  Layers,
  Activity,
  Shield,
  Zap,
  BarChart3,
  CircleDot,
  ArrowRightLeft,
  AlertTriangle,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";

const FEATURES = [
  { icon: Network, title: "Graph Export", description: "Full dependency graph with nodes and edges" },
  { icon: FileCode, title: "Function Context", description: "Get complete context for any function" },
  { icon: GitBranch, title: "File Dependents", description: "Find all files depending on a target" },
  { icon: Search, title: "Symbol References", description: "Locate all references to any symbol" },
  { icon: Layers, title: "Call Chain", description: "Trace execution paths between functions" },
  { icon: Activity, title: "Dead Code Detection", description: "Identify unused code in your project" },
  { icon: Zap, title: "Hotspots", description: "Find frequently changed, high-risk files" },
  { icon: Shield, title: "Impact Analysis", description: "Assess blast radius of code changes" },
  { icon: ArrowRightLeft, title: "Module Coupling", description: "Measure inter-module dependencies" },
  { icon: CircleDot, title: "Circular Dependencies", description: "Detect and visualize import cycles" },
  { icon: BarChart3, title: "Complexity Metrics", description: "Cyclomatic and cognitive complexity" },
  { icon: AlertTriangle, title: "Change Risk", description: "Score risk of modifying a file" },
] as const;

export default function OverviewPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-16">
      {/* Hero */}
      <section className="text-center space-y-4">
        <div className="flex items-center justify-center gap-3 mb-6">
          <Network className="h-10 w-10 text-primary-600" />
        </div>
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">
          MCP Context Manager
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          A Model Context Protocol server that indexes your codebase, builds a dependency graph,
          and exposes powerful analysis tools for AI agents and developers.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Badge variant="outline">v1.0.0</Badge>
          <Badge variant="secondary">15 API Endpoints</Badge>
          <Badge variant="secondary">Python & TypeScript</Badge>
        </div>
        <div className="pt-4">
          <Link to="/setup">
            <Button size="lg">Get Started</Button>
          </Link>
        </div>
      </section>

      {/* What is MCP? */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-slate-900">What is MCP?</h2>
        <p className="text-slate-600 leading-relaxed">
          The Model Context Protocol (MCP) is an open standard that enables AI assistants to
          interact with external tools and data sources through a unified interface. MCP Context
          Manager implements this protocol to give AI agents deep understanding of your codebase
          structure, dependencies, and relationships.
        </p>
        <p className="text-slate-600 leading-relaxed">
          By indexing your source files and building a comprehensive dependency graph, the MCP
          Context Manager enables AI agents to answer complex questions about your code: &ldquo;What
          functions call this method?&rdquo;, &ldquo;What&rsquo;s the impact of changing this
          file?&rdquo;, &ldquo;Are there circular dependencies?&rdquo;
        </p>
      </section>

      {/* Architecture Diagram */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-slate-900">Architecture</h2>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-8">
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            {[
              { label: "File Watcher", sub: "Monitors changes" },
              { label: "AST Parser", sub: "Extracts structure" },
              { label: "Graph Store", sub: "In-memory graph" },
              { label: "HTTP API", sub: "REST + SSE" },
              { label: "UI / Agents", sub: "Consumers" },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center mb-2">
                    <span className="text-xs font-medium text-slate-700 text-center px-1">
                      {step.label}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">{step.sub}</span>
                </div>
                {i < 4 && (
                  <div className="mx-2 text-slate-300 text-lg">&rarr;</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-slate-900">Features</h2>
        <p className="text-slate-600">
          12 powerful analysis tools exposed via REST API and MCP protocol.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary-50">
                    <feature.icon className="h-4 w-4 text-primary-600" />
                  </div>
                  <CardTitle className="text-sm">{feature.title}</CardTitle>
                </div>
                <CardDescription className="mt-2">{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-3 gap-6">
        {[
          { value: "200+", label: "Files Indexed" },
          { value: "15", label: "API Endpoints" },
          { value: "2", label: "Languages Supported" },
        ].map((stat) => (
          <div key={stat.label} className="text-center p-6 bg-slate-50 rounded-lg border border-slate-200">
            <div className="text-3xl font-bold text-primary-600">{stat.value}</div>
            <div className="text-sm text-slate-600 mt-1">{stat.label}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
