/**
 * AI Agents Page — Configuration guides for Claude Desktop, Cursor, and Kiro.
 *
 * Provides step-by-step setup instructions, JSON configuration blocks,
 * available MCP tools list, usage examples, and troubleshooting for each agent.
 */
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../components/ui/accordion";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { AgentCard } from "../components/docs/AgentCard";
import { ConfigBlock } from "../components/docs/ConfigBlock";
import { ToolList } from "../components/docs/ToolList";
import { CodeBlock } from "../components/ui/code-block";
import {
  Bot,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  MessageSquare,
} from "lucide-react";

/** MCP tools available through the Context Manager */
const MCP_TOOLS = [
  {
    name: "get_function_context",
    description: "Get the graph neighborhood around a function (callers, callees, related files)",
    parameters: "function_name, file_path?, max_hops?, max_nodes?",
  },
  {
    name: "get_file_dependents",
    description: "Find files that depend on or are depended upon by a given file",
    parameters: "file_path, direction?, depth?, max_files?",
  },
  {
    name: "get_symbol_references",
    description: "Find all references to a symbol across the codebase",
    parameters: "symbol_qualified_name, include_reads?, include_writes?, include_calls?",
  },
  {
    name: "export_dependency_graph",
    description: "Export a graph slice for visualization (repo, file, or symbol scope)",
    parameters: "scope, file_path?, symbol_qualified_name?, max_nodes?, max_edges?",
  },
  {
    name: "get_callers",
    description: "Reverse call graph — find all functions that call a given function",
    parameters: "function_name, file_path?, max_depth?, max_results?",
  },
  {
    name: "get_call_chain",
    description: "Full call chain traversal as a directed subgraph (upstream/downstream)",
    parameters: "function_name, direction?, max_depth?, max_nodes?",
  },
  {
    name: "get_dead_code",
    description: "Find functions/classes with zero inbound call or instantiation edges",
    parameters: "file_pattern?, language?, kind?, max_results?",
  },
  {
    name: "get_impact_analysis",
    description: "Compute transitive closure of files/symbols affected by a change",
    parameters: "file_path, max_depth?, max_files?",
  },
  {
    name: "get_module_coupling",
    description: "Compute coupling metrics between two file paths",
    parameters: "file_path_a, file_path_b, max_depth?",
  },
  {
    name: "get_hotspots",
    description: "Return the top-N most-referenced symbols (highest fan-in)",
    parameters: "top_n?, kind?, language?, file_pattern?",
  },
  {
    name: "get_class_hierarchy",
    description: "Return the inheritance tree (parents and children) for a class",
    parameters: "class_name, file_path?, direction?, max_depth?",
  },
  {
    name: "search_symbols",
    description: "Fuzzy or regex search across all symbols by name, kind, or file path",
    parameters: "query, kind?, language?, use_regex?, max_results?",
  },
];

/** Configuration JSON for each agent */
const CLAUDE_CONFIG = JSON.stringify(
  {
    mcpServers: {
      "mcp-context-manager": {
        command: "docker",
        args: [
          "exec",
          "-i",
          "mcp-context-manager",
          "node",
          "dist/server.js",
          "--stdio-only",
        ],
      },
    },
  },
  null,
  2
);

const CURSOR_CONFIG = JSON.stringify(
  {
    mcpServers: {
      "mcp-context-manager": {
        url: "http://localhost:3001",
        transport: "http",
      },
    },
  },
  null,
  2
);

const KIRO_CONFIG = JSON.stringify(
  {
    mcpServers: {
      "mcp-context-manager": {
        command: "docker",
        args: [
          "exec",
          "-i",
          "mcp-context-manager",
          "node",
          "dist/server.js",
          "--stdio",
        ],
        disabled: false,
        autoApprove: [],
      },
    },
  },
  null,
  2
);

/** Example prompts for each agent */
const USAGE_EXAMPLES = [
  {
    prompt: "What functions call `send_email` in the backend?",
    tool: "get_callers",
    description: "Finds all upstream callers of the send_email function",
  },
  {
    prompt: "Show me the impact of changing `backend/app/models/user.py`",
    tool: "get_impact_analysis",
    description: "Computes transitive closure of affected files and suggests test files",
  },
  {
    prompt: "Are there any dead code functions in the backend?",
    tool: "get_dead_code",
    description: "Identifies functions with zero inbound call edges",
  },
];

export default function AgentsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      {/* Introduction */}
      <section className="space-y-4">
        <h1 className="text-3xl font-bold text-slate-900">AI Agent Configuration</h1>
        <div className="space-y-3 text-slate-600 leading-relaxed">
          <p>
            The MCP Context Manager exposes 12 code analysis tools via the{" "}
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:underline font-medium"
            >
              Model Context Protocol
            </a>
            . AI agents that support MCP can connect to this service and use these tools
            to understand your codebase structure, trace dependencies, and analyze code relationships.
          </p>
          <p>
            Once configured, your AI assistant can answer questions like &ldquo;What calls this function?&rdquo;,
            &ldquo;What files would be affected if I change this module?&rdquo;, or
            &ldquo;Show me the class hierarchy for UserModel&rdquo; — all backed by live, real-time
            graph data from your actual codebase.
          </p>
          <p>
            Below you&apos;ll find configuration guides for three supported AI agents. Each requires
            the MCP Context Manager to be running (via Docker) on port 3001.
          </p>
        </div>
      </section>

      <Separator />

      {/* Agent Cards Grid */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Supported Agents</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AgentCard
            name="Claude Desktop"
            description="Anthropic's desktop AI assistant with native MCP support"
            configPath="claude_desktop_config.json"
            icon={<Bot className="h-5 w-5" />}
            status="supported"
          />
          <AgentCard
            name="Cursor"
            description="AI-powered code editor with HTTP-based MCP transport"
            configPath=".cursor/mcp.json"
            icon={<Terminal className="h-5 w-5" />}
            status="supported"
          />
          <AgentCard
            name="Kiro"
            description="AI development environment with stdio MCP integration"
            configPath=".kiro/settings/mcp.json"
            icon={<MessageSquare className="h-5 w-5" />}
            status="supported"
          />
        </div>
      </section>

      <Separator />

      {/* Detailed Configuration Sections */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Configuration Details</h2>

        <Accordion type="multiple" className="w-full">
          {/* Claude Desktop */}
          <AccordionItem value="claude">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary-600" />
                <span className="font-medium">Claude Desktop</span>
                <Badge variant="success" className="ml-2">Recommended</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-6">
                {/* Prerequisites */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success-500" />
                    Prerequisites
                  </h4>
                  <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-6">
                    <li>Docker running with the MCP Context Manager container active</li>
                    <li>MCP Context Manager accessible on port 3001</li>
                    <li>Claude Desktop app installed (macOS or Windows)</li>
                  </ul>
                </div>

                {/* Configuration */}
                <ConfigBlock
                  filePath="~/Library/Application Support/Claude/claude_desktop_config.json"
                  config={CLAUDE_CONFIG}
                  title="Claude Desktop MCP Configuration"
                />

                {/* Setup Steps */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800">Setup Steps</h4>
                  <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1.5 ml-6">
                    <li>Open Claude Desktop settings (⌘ + , on macOS)</li>
                    <li>Navigate to the &ldquo;Developer&rdquo; section</li>
                    <li>Click &ldquo;Edit Config&rdquo; to open the configuration file</li>
                    <li>Paste the JSON configuration above</li>
                    <li>Restart Claude Desktop</li>
                    <li>Verify the MCP tools appear in the tool picker (🔧 icon)</li>
                  </ol>
                </div>

                {/* Troubleshooting */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning-500" />
                    Troubleshooting
                  </h4>
                  <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-6">
                    <li><strong>Tools not appearing:</strong> Ensure the Docker container name matches exactly (<code className="text-xs bg-slate-100 px-1 rounded">mcp-context-manager</code>)</li>
                    <li><strong>Connection refused:</strong> Verify the container is running with <code className="text-xs bg-slate-100 px-1 rounded">docker ps</code></li>
                    <li><strong>Permission denied:</strong> Ensure Docker is accessible without sudo</li>
                  </ul>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Cursor */}
          <AccordionItem value="cursor">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-primary-600" />
                <span className="font-medium">Cursor</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-6">
                {/* Prerequisites */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success-500" />
                    Prerequisites
                  </h4>
                  <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-6">
                    <li>Docker running with the MCP Context Manager container active</li>
                    <li>MCP Context Manager HTTP API accessible on <code className="text-xs bg-slate-100 px-1 rounded">http://localhost:3001</code></li>
                    <li>Cursor editor installed with MCP support enabled</li>
                  </ul>
                </div>

                {/* Configuration */}
                <ConfigBlock
                  filePath=".cursor/mcp.json"
                  config={CURSOR_CONFIG}
                  title="Cursor MCP Configuration"
                />

                {/* Setup Steps */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800">Setup Steps</h4>
                  <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1.5 ml-6">
                    <li>Create a <code className="text-xs bg-slate-100 px-1 rounded">.cursor/</code> directory in your project root</li>
                    <li>Create <code className="text-xs bg-slate-100 px-1 rounded">.cursor/mcp.json</code> with the configuration above</li>
                    <li>Restart Cursor or reload the window</li>
                    <li>The MCP tools will be available in Cursor&apos;s AI chat</li>
                  </ol>
                </div>

                {/* Note about HTTP transport */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-blue-800">
                      Cursor uses HTTP transport instead of stdio. This means it connects directly
                      to the MCP Context Manager&apos;s HTTP API on port 3001. No Docker exec is needed.
                    </p>
                  </div>
                </div>

                {/* Troubleshooting */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning-500" />
                    Troubleshooting
                  </h4>
                  <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-6">
                    <li><strong>Connection refused:</strong> Ensure port 3001 is exposed in your Docker setup</li>
                    <li><strong>Timeout errors:</strong> Check that the MCP service is healthy: <code className="text-xs bg-slate-100 px-1 rounded">curl http://localhost:3001/api/v1/health</code></li>
                    <li><strong>Tools not loading:</strong> Verify the <code className="text-xs bg-slate-100 px-1 rounded">.cursor/mcp.json</code> file is valid JSON</li>
                  </ul>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Kiro */}
          <AccordionItem value="kiro">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary-600" />
                <span className="font-medium">Kiro</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-6">
                {/* Prerequisites */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success-500" />
                    Prerequisites
                  </h4>
                  <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-6">
                    <li>Docker running with the MCP Context Manager container active</li>
                    <li>MCP Context Manager accessible on port 3001</li>
                    <li>Kiro IDE installed</li>
                  </ul>
                </div>

                {/* Configuration */}
                <ConfigBlock
                  filePath=".kiro/settings/mcp.json"
                  config={KIRO_CONFIG}
                  title="Kiro MCP Configuration"
                />

                {/* Setup Steps */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800">Setup Steps</h4>
                  <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1.5 ml-6">
                    <li>Create <code className="text-xs bg-slate-100 px-1 rounded">.kiro/settings/</code> directory in your project root</li>
                    <li>Create <code className="text-xs bg-slate-100 px-1 rounded">.kiro/settings/mcp.json</code> with the configuration above</li>
                    <li>Kiro will automatically detect the configuration change</li>
                    <li>Use the command palette to search &ldquo;MCP&rdquo; and verify the server is connected</li>
                    <li>Tools will be available in Kiro&apos;s agent chat</li>
                  </ol>
                </div>

                {/* Note about autoApprove */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-blue-800">
                      The <code className="text-xs bg-blue-100 px-1 rounded">autoApprove</code> array
                      can list tool names that Kiro will execute without asking for confirmation.
                      Leave empty for manual approval of all tool calls, or add tool names like{" "}
                      <code className="text-xs bg-blue-100 px-1 rounded">&quot;get_function_context&quot;</code>{" "}
                      for read-only tools you trust.
                    </p>
                  </div>
                </div>

                {/* Troubleshooting */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning-500" />
                    Troubleshooting
                  </h4>
                  <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-6">
                    <li><strong>Server not connecting:</strong> Check the MCP Server view in Kiro&apos;s feature panel</li>
                    <li><strong>Container not found:</strong> Verify the container name matches (<code className="text-xs bg-slate-100 px-1 rounded">mcp-context-manager</code>)</li>
                    <li><strong>Disabled server:</strong> Ensure <code className="text-xs bg-slate-100 px-1 rounded">&quot;disabled&quot;: false</code> in the config</li>
                  </ul>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <Separator />

      {/* Available Tools */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Available MCP Tools</h2>
        <p className="text-sm text-slate-600">
          All configured agents have access to the following 12 code analysis tools.
          Click any tool to see its parameters.
        </p>
        <ToolList tools={MCP_TOOLS} />
      </section>

      <Separator />

      {/* Usage Examples */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Usage Examples</h2>
        <p className="text-sm text-slate-600">
          Here are example prompts you can use with any configured AI agent:
        </p>
        <div className="space-y-4">
          {USAGE_EXAMPLES.map((example) => (
            <div
              key={example.tool}
              className="border border-slate-200 rounded-lg p-4 space-y-2"
            >
              <div className="flex items-center gap-2">
                <Badge variant="default">{example.tool}</Badge>
              </div>
              <p className="text-sm font-medium text-slate-800 italic">
                &ldquo;{example.prompt}&rdquo;
              </p>
              <p className="text-xs text-slate-500">{example.description}</p>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* Verification */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Verify Your Connection</h2>
        <p className="text-sm text-slate-600">
          After configuring your agent, verify the MCP Context Manager is accessible:
        </p>
        <CodeBlock
          code={`# Check if the service is running
curl http://localhost:3001/api/v1/health
# Expected: {"status":"ok"} or {"status":"degraded","reasons":[...]}

# Test a simple tool call
curl "http://localhost:3001/api/v1/mcp/search?query=main&max_results=5"
# Expected: JSON with search results

# Verify Docker container is running
docker ps | grep mcp-context-manager
# Expected: Container listed with status "Up"`}
          language="bash"
          title="Verification Commands"
        />
      </section>
    </div>
  );
}
