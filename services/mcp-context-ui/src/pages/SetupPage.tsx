/**
 * Setup page — Docker setup wizard and manual configuration guide.
 *
 * Features:
 * - Health check gate: shows green badge if MCP service is running
 * - Multi-step Docker setup wizard for generating docker-compose.yml + .env
 * - Manual setup instructions with copy-to-clipboard commands
 */
import { useState, useCallback, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  Server,
  FolderOpen,
  Settings,
  Network as NetworkIcon,
  HardDrive,
  FileOutput,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { StatusBadge } from "../components/docs/StatusBadge";
import { StepWizard, type WizardStep } from "../components/docs/StepWizard";
import { DocsCodeBlock } from "../components/docs/CodeBlock";
import { CodeBlock } from "../components/ui/code-block";
import {
  generateDockerCompose,
  generateEnvFile,
  generateRunCommands,
  DEFAULT_CONFIG,
  type DockerConfig,
  type VolumeMapping,
} from "../lib/docker-compose-generator";
import api from "../api/instance";

type HealthStatus = "loading" | "healthy" | "degraded" | "unhealthy";

const WIZARD_STEPS: WizardStep[] = [
  { id: "prerequisites", title: "Prerequisites", description: "Verify required tools are installed." },
  { id: "service-config", title: "Service Config", description: "Configure the MCP Context Manager service." },
  { id: "environment", title: "Environment", description: "Set environment variables." },
  { id: "ports", title: "Port Mapping", description: "Configure exposed ports." },
  { id: "volumes", title: "Volumes", description: "Map source directories into the container." },
  { id: "output", title: "Generated Output", description: "Review and download your configuration files." },
];

export default function SetupPage() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("loading");
  const [showWizard, setShowWizard] = useState(false);
  const [config, setConfig] = useState<DockerConfig>(DEFAULT_CONFIG);

  // Health check on mount
  useEffect(() => {
    let cancelled = false;
    async function checkHealth() {
      try {
        const response = await api.get("/health", { timeout: 5000 });
        if (!cancelled) {
          const s = response.data?.status;
          if (s === "ok") {
            setHealthStatus("healthy");
          } else if (s === "degraded") {
            setHealthStatus("degraded");
          } else {
            setHealthStatus("unhealthy");
          }
        }
      } catch {
        if (!cancelled) {
          setHealthStatus("unhealthy");
        }
      }
    }
    checkHealth();
    return () => { cancelled = true; };
  }, []);

  const updateConfig = useCallback((partial: Partial<DockerConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const updateVolume = useCallback((index: number, update: Partial<VolumeMapping>) => {
    setConfig((prev) => {
      const volumes = [...prev.volumes];
      volumes[index] = { ...volumes[index], ...update };
      return { ...prev, volumes };
    });
  }, []);

  const addVolume = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      volumes: [...prev.volumes, { source: "", readOnly: true }],
    }));
  }, []);

  const removeVolume = useCallback((index: number) => {
    setConfig((prev) => ({
      ...prev,
      volumes: prev.volumes.filter((_, i) => i !== index),
    }));
  }, []);

  // Generated outputs
  const dockerComposeYaml = generateDockerCompose(config);
  const envFileContent = generateEnvFile(config);
  const runCommands = generateRunCommands(config);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 space-y-10">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">Setup</h1>
        <p className="text-slate-600">
          Configure and deploy the MCP Context Manager using Docker.
        </p>
      </div>

      {/* Health Check Gate */}
      <HealthCheckSection status={healthStatus} />

      {/* Docker Setup Wizard */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-primary-600" />
            <h2 className="text-xl font-semibold text-slate-900">Docker Setup Wizard</h2>
          </div>
          {healthStatus === "healthy" && !showWizard && (
            <Button variant="outline" size="sm" onClick={() => setShowWizard(true)}>
              Reconfigure
            </Button>
          )}
        </div>

        {(healthStatus !== "healthy" || showWizard) && (
          <Card>
            <CardContent className="pt-6">
              <StepWizard steps={WIZARD_STEPS} onComplete={() => {}}>
                {(step) => (
                  <WizardStepContent
                    step={step}
                    config={config}
                    updateConfig={updateConfig}
                    updateVolume={updateVolume}
                    addVolume={addVolume}
                    removeVolume={removeVolume}
                    dockerComposeYaml={dockerComposeYaml}
                    envFileContent={envFileContent}
                    runCommands={runCommands}
                  />
                )}
              </StepWizard>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Manual Setup Section */}
      <ManualSetupSection config={config} />
    </div>
  );
}

/* ─── Health Check Section ─────────────────────────────────────────────── */

function HealthCheckSection({ status }: { status: HealthStatus }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-slate-600" />
            <CardTitle className="text-base">Service Status</CardTitle>
          </div>
          {status === "loading" && (
            <StatusBadge variant="loading" label="Checking..." />
          )}
          {status === "healthy" && (
            <StatusBadge variant="success" label="✓ MCP Context Manager is running" />
          )}
          {status === "degraded" && (
            <StatusBadge variant="warning" label="⚠ Service degraded — 0 files indexed" />
          )}
          {status === "unhealthy" && (
            <StatusBadge variant="error" label="✗ Service not reachable" />
          )}
        </div>
        <CardDescription>
          {status === "healthy"
            ? "The MCP Context Manager is running and healthy. You can skip the setup wizard or reconfigure."
            : status === "degraded"
            ? "The MCP Context Manager is running but indexed 0 files. Check WORKSPACE_PATH and glob patterns, then reconfigure below."
            : status === "unhealthy"
            ? "The MCP Context Manager is not reachable. Follow the setup wizard below to get started."
            : "Checking connection to MCP Context Manager..."}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/* ─── Wizard Step Content ──────────────────────────────────────────────── */

interface WizardStepContentProps {
  step: number;
  config: DockerConfig;
  updateConfig: (partial: Partial<DockerConfig>) => void;
  updateVolume: (index: number, update: Partial<VolumeMapping>) => void;
  addVolume: () => void;
  removeVolume: (index: number) => void;
  dockerComposeYaml: string;
  envFileContent: string;
  runCommands: string;
}

function WizardStepContent({
  step,
  config,
  updateConfig,
  updateVolume,
  addVolume,
  removeVolume,
  dockerComposeYaml,
  envFileContent,
  runCommands,
}: WizardStepContentProps) {
  switch (step) {
    case 0:
      return <PrerequisitesStep />;
    case 1:
      return <ServiceConfigStep config={config} updateConfig={updateConfig} />;
    case 2:
      return <EnvironmentStep config={config} updateConfig={updateConfig} />;
    case 3:
      return <PortMappingStep config={config} updateConfig={updateConfig} />;
    case 4:
      return (
        <VolumeMappingStep
          config={config}
          updateVolume={updateVolume}
          addVolume={addVolume}
          removeVolume={removeVolume}
        />
      );
    case 5:
      return (
        <OutputStep
          dockerComposeYaml={dockerComposeYaml}
          envFileContent={envFileContent}
          runCommands={runCommands}
        />
      );
    default:
      return null;
  }
}

/* ─── Step 1: Prerequisites ────────────────────────────────────────────── */

function PrerequisitesStep() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Ensure the following tools are installed on your system before proceeding.
      </p>
      <div className="space-y-3">
        {[
          { name: "Docker", description: "Container runtime (v20.10+)", required: true },
          { name: "Docker Compose", description: "Multi-container orchestration (v2.0+)", required: true },
          { name: "Node.js", description: "For local development only (v20+)", required: false },
        ].map((tool) => (
          <div
            key={tool.name}
            className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50"
          >
            <CheckCircle2 className="h-5 w-5 text-slate-400 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900">{tool.name}</span>
                {tool.required ? (
                  <Badge variant="default" className="text-[10px]">Required</Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{tool.description}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 p-3 bg-primary-50 border border-primary-200 rounded-lg">
        <p className="text-xs text-primary-700">
          <strong>Tip:</strong> Run <code className="bg-primary-100 px-1 rounded">docker --version</code> and{" "}
          <code className="bg-primary-100 px-1 rounded">docker compose version</code> to verify installation.
        </p>
      </div>
    </div>
  );
}

/* ─── Step 2: Service Configuration ───────────────────────────────────── */

function ServiceConfigStep({
  config,
  updateConfig,
}: {
  config: DockerConfig;
  updateConfig: (partial: Partial<DockerConfig>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="workspace-root">Workspace Root Path</Label>
        <Input
          id="workspace-root"
          value={config.workspaceRoot}
          onChange={(e) => updateConfig({ workspaceRoot: e.target.value })}
          placeholder="./"
        />
        <p className="text-xs text-slate-500">
          Path to your project root relative to the docker-compose.yml file.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="memory-limit">Memory Limit</Label>
        <Select
          value={config.memoryLimit}
          onValueChange={(value) => updateConfig({ memoryLimit: value })}
        >
          <SelectTrigger id="memory-limit">
            <SelectValue placeholder="Select memory limit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="256M">256 MB — Small projects (&lt;100 files)</SelectItem>
            <SelectItem value="512M">512 MB — Medium projects (100-500 files)</SelectItem>
            <SelectItem value="1G">1 GB — Large projects (500+ files)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Watched Directories</Label>
        <p className="text-xs text-slate-500 mb-2">
          Directories the MCP Context Manager will monitor for file changes.
        </p>
        <div className="flex flex-wrap gap-2">
          {config.watchedDirs.map((dir) => (
            <Badge key={dir} variant="secondary" className="text-xs">
              <FolderOpen className="h-3 w-3 mr-1" />
              {dir}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Step 3: Environment Variables ───────────────────────────────────── */

function EnvironmentStep({
  config,
  updateConfig,
}: {
  config: DockerConfig;
  updateConfig: (partial: Partial<DockerConfig>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="env-workspace">WORKSPACE_ROOT</Label>
          <Input
            id="env-workspace"
            value="/workspace"
            disabled
            className="bg-slate-50"
          />
          <p className="text-xs text-slate-500">Container-internal path (auto-configured).</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="env-port">HTTP_PORT</Label>
          <Input
            id="env-port"
            type="number"
            value={config.httpPort}
            onChange={(e) => updateConfig({ httpPort: parseInt(e.target.value, 10) || 3001 })}
          />
          <p className="text-xs text-slate-500">Internal API port.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-level">LOG_LEVEL</Label>
        <Select
          value={config.logLevel}
          onValueChange={(value) => updateConfig({ logLevel: value })}
        >
          <SelectTrigger id="log-level">
            <SelectValue placeholder="Select log level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="debug">debug — Verbose output for development</SelectItem>
            <SelectItem value="info">info — Standard operational logging</SelectItem>
            <SelectItem value="warn">warn — Warnings and errors only</SelectItem>
            <SelectItem value="error">error — Errors only</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/* ─── Step 4: Port Mapping ─────────────────────────────────────────────── */

function PortMappingStep({
  config,
  updateConfig,
}: {
  config: DockerConfig;
  updateConfig: (partial: Partial<DockerConfig>) => void;
}) {
  const hasPortConflict = config.httpPort === config.uiPort;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="port-mcp">
            <NetworkIcon className="h-3.5 w-3.5 inline mr-1" />
            MCP Context Manager
          </Label>
          <Input
            id="port-mcp"
            type="number"
            value={config.httpPort}
            onChange={(e) => updateConfig({ httpPort: parseInt(e.target.value, 10) || 3001 })}
            min={1024}
            max={65535}
          />
          <p className="text-xs text-slate-500">API server port (default: 3001)</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="port-ui">
            <NetworkIcon className="h-3.5 w-3.5 inline mr-1" />
            MCP Context UI
          </Label>
          <Input
            id="port-ui"
            type="number"
            value={config.uiPort}
            onChange={(e) => updateConfig({ uiPort: parseInt(e.target.value, 10) || 8080 })}
            min={1024}
            max={65535}
          />
          <p className="text-xs text-slate-500">Web UI port (default: 8080)</p>
        </div>
      </div>

      {hasPortConflict && (
        <div className="flex items-center gap-2 p-3 bg-warning-50 border border-warning-500/30 rounded-lg">
          <XCircle className="h-4 w-4 text-warning-500 shrink-0" />
          <p className="text-xs text-warning-500 font-medium">
            Port conflict detected: MCP Manager and UI cannot use the same port.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Step 5: Volume Mapping ───────────────────────────────────────────── */

function VolumeMappingStep({
  config,
  updateVolume,
  addVolume,
  removeVolume,
}: {
  config: DockerConfig;
  updateVolume: (index: number, update: Partial<VolumeMapping>) => void;
  addVolume: () => void;
  removeVolume: (index: number) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Map your source directories into the container. The MCP Context Manager needs read access
        to parse your codebase.
      </p>

      <div className="space-y-3">
        {config.volumes.map((vol, index) => (
          <div key={index} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg">
            <HardDrive className="h-4 w-4 text-slate-400 shrink-0" />
            <Input
              value={vol.source}
              onChange={(e) => updateVolume(index, { source: e.target.value })}
              placeholder="e.g., backend"
              className="flex-1"
              aria-label={`Volume source path ${index + 1}`}
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={vol.readOnly}
                onChange={(e) => updateVolume(index, { readOnly: e.target.checked })}
                className="rounded border-slate-300"
              />
              Read-only
            </label>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeVolume(index)}
              aria-label={`Remove volume ${vol.source}`}
              className="h-8 w-8 text-slate-400 hover:text-danger-600"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addVolume}>
        + Add Volume
      </Button>
    </div>
  );
}

/* ─── Step 6: Generated Output ─────────────────────────────────────────── */

function OutputStep({
  dockerComposeYaml,
  envFileContent,
  runCommands,
}: {
  dockerComposeYaml: string;
  envFileContent: string;
  runCommands: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 bg-success-50 border border-success-500/30 rounded-lg">
        <CheckCircle2 className="h-4 w-4 text-success-600 shrink-0" />
        <p className="text-sm text-success-600 font-medium">
          Configuration complete! Review and download your files below.
        </p>
      </div>

      <Tabs defaultValue="docker-compose">
        <TabsList>
          <TabsTrigger value="docker-compose">docker-compose.yml</TabsTrigger>
          <TabsTrigger value="env">.env</TabsTrigger>
          <TabsTrigger value="commands">Run Commands</TabsTrigger>
        </TabsList>

        <TabsContent value="docker-compose" className="mt-4">
          <DocsCodeBlock
            code={dockerComposeYaml}
            language="yaml"
            title="docker-compose.yml"
            fileName="docker-compose.yml"
            showDownload
          />
        </TabsContent>

        <TabsContent value="env" className="mt-4">
          <DocsCodeBlock
            code={envFileContent}
            language="bash"
            title=".env"
            fileName=".env"
            showDownload
          />
        </TabsContent>

        <TabsContent value="commands" className="mt-4">
          <DocsCodeBlock
            code={runCommands}
            language="bash"
            title="Quick Start Commands"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Manual Setup Section ─────────────────────────────────────────────── */

function ManualSetupSection({ config }: { config: DockerConfig }) {
  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <FileOutput className="h-5 w-5 text-slate-600" />
        <h2 className="text-xl font-semibold text-slate-900">Manual Setup</h2>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Step 1 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">1. Clone the repository</h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-slate-900 text-slate-100 px-4 py-2.5 rounded-md font-mono">
                git clone &lt;your-repo-url&gt; &amp;&amp; cd &lt;project-root&gt;
              </code>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">2. Start the MCP services</h3>
            <div className="relative">
              <CodeBlock
                code="docker-compose up -d mcp-context-manager mcp-ui"
                language="bash"
                title="Terminal"
              />
            </div>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">3. Verify the service is healthy</h3>
            <div className="relative">
              <CodeBlock
                code={`curl http://localhost:${config.httpPort}/api/v1/health\n# Expected: {"status":"ok"} or {"status":"degraded","reasons":[...]}`}
                language="bash"
                title="Terminal"
              />
            </div>
          </div>

          {/* Step 4 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">4. Open the UI</h3>
            <p className="text-sm text-slate-600">
              Navigate to{" "}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-primary-600 text-xs">
                http://localhost:{config.uiPort}
              </code>{" "}
              in your browser.
            </p>
          </div>

          {/* Troubleshooting */}
          <div className="border-t border-slate-200 pt-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Troubleshooting</h3>
            <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside">
              <li>
                If the health check fails, check logs:{" "}
                <code className="bg-slate-100 px-1 rounded text-xs">docker-compose logs mcp-context-manager</code>
              </li>
              <li>
                Ensure ports {config.httpPort} and {config.uiPort} are not in use by other services.
              </li>
              <li>
                Rebuild after code changes:{" "}
                <code className="bg-slate-100 px-1 rounded text-xs">docker-compose build --no-cache mcp-ui</code>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
