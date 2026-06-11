"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useMemo, useRef, useState, useEffect } from "react";
import {
  PlayIcon,
  StopIcon,
  CopyIcon,
  TrashIcon,
  WarningIcon,
  CheckIcon,
  FolderIcon,
  GitBranchIcon,
  CaretDownIcon,
  CircleNotchIcon,
  ArrowCounterClockwiseIcon,
  FileCodeIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { RepoPathPicker } from "@/components/canvas/RepoPathPicker";
import { saveLastUsedAgent, getLastUsedAgent } from "@/lib/last-used-agent";
import { cn } from "@/lib/cn";

type Line = { level: string; text: string };

const AGENTS = ["fake", "codex", "claude", "gemini", "kiro"] as const;
type AgentName = (typeof AGENTS)[number];

const promptTemplates = [
  { label: "Create HELLO.md", text: "Create a file HELLO.md with one line: hi from the orchestrator. Then stop." },
  { label: "Add README section", text: "Add a section to the README.md file explaining how to run the dev script. Then stop." },
  { label: "Create test file", text: "Create a small test file named test.txt. Then stop." },
  { label: "Inspect & Summarize", text: "Inspect the repository structure, read the main files, and write a summary in summary.md. Then stop." },
];

export default function DebugRunPage() {
  const trpc = useTRPC();

  const createGraph = useMutation(trpc.graphs.create.mutationOptions());
  const updateGraph = useMutation(trpc.graphs.update.mutationOptions());
  const createRun = useMutation(trpc.runs.create.mutationOptions());
  const startRun = useMutation(trpc.runs.start.mutationOptions());
  const cancelRunMutation = useMutation(trpc.runs.cancel.mutationOptions());

  // Inputs
  const [repoPath, setRepoPath] = useState("");
  const [cli, setCli] = useState<AgentName>("fake");
  const [prompt, setPrompt] = useState(
    "Create a file HELLO.md with one line: hi from the orchestrator. Then stop.",
  );

  // Suggested & Recent Repo Paths
  const [recentRepos, setRecentRepos] = useState<string[]>([]);

  // UI state
  const [status, setStatus] = useState("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [patchPreview, setPatchPreview] = useState<string | null>(null);
  const [filesChanged, setFilesChanged] = useState<string[]>([]);
  const [outputSummary, setOutputSummary] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeTab, setActiveTab] = useState<"logs" | "patch" | "errors">("logs");
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Load defaults / last-used configurations
  const defaultRootQuery = useQuery(
    trpc.repo.defaultRoot.queryOptions(undefined, { refetchOnWindowFocus: false }),
  );
  const defaultRoot = defaultRootQuery.data?.path || "";

  const capabilitiesQuery = useQuery(
    trpc.system.capabilities.queryOptions(undefined, { refetchOnWindowFocus: false }),
  );
  const capabilities = capabilitiesQuery.data;

  // Load recent repos & last used agent from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedRepos = window.localStorage.getItem("orchestrator:debugRun:recentRepos");
      if (storedRepos) {
        try {
          const parsed = JSON.parse(storedRepos);
          if (Array.isArray(parsed)) {
            setRecentRepos(parsed.filter((p) => typeof p === "string"));
          }
        } catch {}
      }

      const lastRepo = window.localStorage.getItem("orchestrator:debugRun:lastRepoPath");
      if (lastRepo) {
        setRepoPath(lastRepo);
      }

      const lastAgent = window.localStorage.getItem("orchestrator:debugRun:lastUsedAgent");
      if (lastAgent && AGENTS.includes(lastAgent as AgentName)) {
        setCli(lastAgent as AgentName);
      } else {
        const globalLastUsed = getLastUsedAgent();
        if (globalLastUsed && AGENTS.includes(globalLastUsed as AgentName)) {
          setCli(globalLastUsed as AgentName);
        }
      }
    }
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setAgentDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Save selected agent when it changes
  const handleSelectAgent = (agent: AgentName) => {
    setCli(agent);
    setAgentDropdownOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("orchestrator:debugRun:lastUsedAgent", agent);
      if (agent !== "fake") {
        saveLastUsedAgent(agent);
      }
    }
  };

  const addRecentRepo = (path: string) => {
    if (!path.trim()) return;
    const next = [path, ...recentRepos.filter((p) => p !== path)].slice(0, 5);
    setRecentRepos(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("orchestrator:debugRun:recentRepos", JSON.stringify(next));
      window.localStorage.setItem("orchestrator:debugRun:lastRepoPath", path);
    }
  };

  // Autoscroll logic
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Path validation logic
  const repoPathNormalized = repoPath.trim();
  const isAbsolutePath = (p: string): boolean => {
    if (!p) return false;
    if (p.startsWith("/")) return true;
    if (/^[a-zA-Z]:[/\\]/.test(p)) return true;
    if (p.startsWith("\\\\")) return true;
    return false;
  };
  const isAbsolute = isAbsolutePath(repoPathNormalized);

  const listDirQuery = useQuery(
    trpc.repo.listDir.queryOptions(
      { path: repoPathNormalized },
      { enabled: !!repoPathNormalized && isAbsolute, refetchOnWindowFocus: false }
    )
  );

  const pathsMatch = (p1: string, p2: string) => {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    return norm(p1) === norm(p2);
  };

  const validation = useMemo(() => {
    if (!repoPathNormalized) {
      return { status: "missing" as const, message: "Path missing" };
    }
    if (!isAbsolute) {
      return { status: "not-absolute" as const, message: "Path must be absolute" };
    }
    if (listDirQuery.isLoading) {
      return { status: "validating" as const, message: "Validating path..." };
    }
    if (listDirQuery.data) {
      const resolved = listDirQuery.data.path;
      if (!pathsMatch(resolved, repoPathNormalized)) {
        return { status: "not-exists" as const, message: "Path does not exist" };
      }
      if (!listDirQuery.data.isGitRepo) {
        return { status: "not-git" as const, message: "Not a git repo" };
      }
      return { status: "valid" as const, message: "Valid repo" };
    }
    return { status: "idle" as const, message: "" };
  }, [repoPathNormalized, isAbsolute, listDirQuery.isLoading, listDirQuery.data]);

  // Resolve agent capability statuses
  const getAgentStatus = (agent: AgentName) => {
    if (agent === "fake") {
      return { badge: "Available" as const, disabled: false };
    }
    if (capabilitiesQuery.isLoading) {
      return { badge: "Checking..." as const, disabled: true, reason: "Loading capabilities..." };
    }
    if (!capabilities) {
      return { badge: "Missing" as const, disabled: true, reason: "CLI missing" };
    }
    const cap = capabilities.find((c) => c.cli === agent);
    if (!cap) {
      return { badge: "Missing" as const, disabled: true, reason: "CLI missing" };
    }
    if (cap.available) {
      return { badge: "Available" as const, disabled: false };
    }

    const note = (cap.note || "").toLowerCase();
    const fix = (cap.suggestedFix || "").toLowerCase();

    if (cap.authMode === "unauthenticated" || note.includes("not signed in") || fix.includes("login")) {
      return { badge: "Needs auth" as const, disabled: true, reason: "not authenticated" };
    }
    if (note.includes("not found") || fix.includes("install") || note.includes("command not found")) {
      return { badge: "Missing" as const, disabled: true, reason: "CLI missing" };
    }
    if (note.includes("not configured") || fix.includes("configure") || note.includes("no model")) {
      return { badge: "Not configured" as const, disabled: true, reason: "not configured" };
    }
    if (note.includes("quota") || note.includes("key") || note.includes("auth failed") || note.includes("unauthorized")) {
      return { badge: "Quota/key issue" as const, disabled: true, reason: "quota/key issue" };
    }

    if (agent === "gemini") {
      return { badge: "Needs auth" as const, disabled: true, reason: "quota/key issue" };
    }
    return { badge: "Missing" as const, disabled: true, reason: "CLI missing" };
  };

  const activeAgentStatus = getAgentStatus(cli);

  const isRunning =
    status === "running" ||
    status.startsWith("creating") ||
    status.startsWith("starting") ||
    status === "running… (watch logs)";

  const runDisabled =
    validation.status !== "valid" ||
    activeAgentStatus.disabled ||
    !prompt.trim() ||
    isRunning;

  function push(level: string, text: string) {
    setLines((prev) => [...prev, { level, text }]);
  }

  async function run() {
    setLines([]);
    setPatchPreview(null);
    setFilesChanged([]);
    setOutputSummary(null);
    setErrorReason(null);
    setWarnings([]);
    esRef.current?.close();

    addRecentRepo(repoPath.trim());

    try {
      setStatus("creating graph…");
      const graph = await createGraph.mutateAsync({ name: "debug run" });
      await updateGraph.mutateAsync({
        id: String(graph._id),
        rootRepoPath: repoPath.trim(),
        nodes: [
          {
            id: "n1",
            kind: "execute",
            label: "debug task",
            position: { x: 0, y: 0 },
            status: "pending",
            data: { cli, prompt, baseRef: "HEAD" },
          },
        ],
        edges: [],
      });

      setStatus("starting run…");
      const created = await createRun.mutateAsync({ graphId: String(graph._id) });
      const runId = String(created._id);
      setCurrentRunId(runId);

      const es = new EventSource(`/api/runs/${runId}/events`);
      esRef.current = es;

      await new Promise<void>((resolve) => {
        es.onopen = () => resolve();
        setTimeout(resolve, 800);
      });

      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as {
            type?: string;
            level?: string;
            payload?: Record<string, unknown>;
            line?: string;
          };

          const type = ev.type ?? ev.payload?.type;
          const level = ev.level ?? ev.type ?? "info";

          if (type === "node.patch" && ev.payload?.patchPreview) {
            setPatchPreview(String(ev.payload.patchPreview));
          }

          if (type === "node.output" && ev.payload?.output) {
            const output = ev.payload.output as {
              summary?: string;
              filesChanged?: string[];
            };
            if (output.summary) setOutputSummary(output.summary);
            if (output.filesChanged) setFilesChanged(output.filesChanged);
          }

          if (type === "node.failed" && ev.payload) {
            const reason = ev.payload.reason ?? ev.payload.stderrPreview ?? ev.payload.message;
            if (reason) setErrorReason(String(reason));
          }

          if (type === "node.rule.warning" && ev.payload?.violatingFiles) {
            const rule = ev.payload.rule;
            const files = ev.payload.violatingFiles as string[];
            setWarnings((prev) => [
              ...prev,
              `Rule violation: ${rule} - offending files: ${files.join(", ")}`,
            ]);
          }

          const text =
            ev.payload?.line ??
            ev.payload?.reason ??
            ev.payload?.message ??
            ev.payload?.stderrPreview ??
            type ??
            JSON.stringify(ev);

          push(level, String(text));

          if (type === "run.completed" || type === "run.failed" || type === "run.cancelled") {
            let finalStatus = "completed";
            if (type === "run.failed") finalStatus = "failed";
            if (type === "run.cancelled") finalStatus = "cancelled";

            setStatus(finalStatus === "completed" ? "completed" : finalStatus === "failed" ? "failed" : "cancelled");
            es.close();
          }
        } catch {
          push("info", e.data);
        }
      };

      es.onerror = () => {
        push("error", "[sse connection closed]");
      };

      await startRun.mutateAsync({ runId });
      setStatus("running… (watch logs)");
    } catch (err) {
      setStatus("failed");
      const msg = err instanceof Error ? err.message : String(err);
      setErrorReason(msg);
      push("error", msg);
    }
  }

  async function cancelRun() {
    if (!currentRunId) return;
    try {
      push("info", "[Cancel requested by user]");
      await cancelRunMutation.mutateAsync({ runId: currentRunId });
      setStatus("cancelled");
      esRef.current?.close();
    } catch (err) {
      push("error", `Cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function clearLogs() {
    setLines([]);
    setPatchPreview(null);
    setFilesChanged([]);
    setOutputSummary(null);
    setErrorReason(null);
    setWarnings([]);
  }

  function copyLogs() {
    const text = lines.map((l) => `[${l.level}] ${l.text}`).join("\n");
    navigator.clipboard.writeText(text);
  }

  function resetPrompt() {
    setPrompt("Create a file HELLO.md with one line: hi from the orchestrator. Then stop.");
  }

  const colorFor = (lvl: string) => {
    if (lvl === "stderr" || lvl === "error") return "text-danger";
    if (lvl === "stdout" || lvl === "success") return "text-success";
    if (lvl === "warn" || lvl === "warning") return "text-warning";
    return "text-muted";
  };

  const getValidationBadgeClass = (status: string) => {
    switch (status) {
      case "valid":
        return "bg-success/10 text-success border border-success/30";
      case "validating":
        return "bg-accent/10 text-accent border border-accent/30";
      case "missing":
        return "bg-muted/10 text-muted border border-muted/30";
      default:
        return "bg-danger/10 text-danger border border-danger/30";
    }
  };

  const getAgentBadgeClass = (badge: string) => {
    switch (badge) {
      case "Available":
        return "bg-success/10 text-success border border-success/20";
      case "Needs auth":
        return "bg-warning/10 text-warning border border-warning/20";
      case "Not configured":
        return "bg-warning/10 text-warning border border-warning/20 animate-pulse";
      case "Quota/key issue":
        return "bg-danger/10 text-danger border border-danger/20";
      case "Missing":
      default:
        return "bg-faint/10 text-faint border border-faint/20";
    }
  };

  const getStatusBadgeClass = (s: string) => {
    if (s.includes("completed") || s === "success") return "bg-success/15 text-success border border-success/30";
    if (s.includes("failed") || s === "failed") return "bg-danger/15 text-danger border border-danger/30";
    if (s.includes("cancelled")) return "bg-muted/15 text-muted border border-muted/30";
    if (s.includes("running") || s.includes("creating") || s.includes("starting")) return "bg-warning/15 text-warning border border-warning/30";
    return "bg-raised/30 text-muted border border-border";
  };

  const currentSuggestions = useMemo(() => {
    const list = [];
    if (defaultRoot) {
      list.push({ label: "Current project repo", path: defaultRoot });
    }
    recentRepos.forEach((r) => {
      if (r !== defaultRoot) {
        list.push({ label: "Recent repo", path: r });
      }
    });
    return list;
  }, [defaultRoot, recentRepos]);

  return (
    <main className="min-h-screen bg-surface text-content font-sans antialiased">
      <div className="mx-auto max-w-4xl px-6 py-10">
        
        {/* Header */}
        <header className="mb-8 border-b border-border pb-6">
          <h1 className="text-3xl font-bold tracking-tight">Debug Run</h1>
          <p className="mt-2 text-sm text-muted">
            Execute a single workspace node through the real runtime to inspect agent behaviors, streaming output, and git diff proposals.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Controls Panel */}
          <div className="md:col-span-1 flex flex-col gap-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">Config & Input</h2>

            {/* Repo path input */}
            <div className="flex flex-col gap-2">
              <Field
                label="Local Git Repo Path (Absolute)"
                error={validation.status !== "valid" && validation.status !== "validating" ? validation.message : undefined}
              >
                <RepoPathPicker value={repoPath} onChange={setRepoPath} />
              </Field>

              {/* Inline validation status */}
              {repoPathNormalized && (validation.status === "valid" || validation.status === "validating") && (
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[10px] font-medium ${getValidationBadgeClass(validation.status)}`}>
                    {validation.status === "validating" && <CircleNotchIcon className="animate-spin" size={10} />}
                    {validation.message}
                  </span>
                </div>
              )}

              {/* Suggestions dropdown */}
              {currentSuggestions.length > 0 && (
                <div className="mt-1">
                  <label className="text-[11px] text-faint block mb-1">Suggested Repositories:</label>
                  <select
                    className="w-full text-xs rounded-sm border border-border bg-panel px-2 py-1 text-content focus:outline-none"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        setRepoPath(e.target.value);
                      }
                    }}
                  >
                    <option value="">-- Choose suggested repo --</option>
                    {currentSuggestions.map((item, idx) => (
                      <option key={idx} value={item.path}>
                        {item.label}: {item.path}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {defaultRoot && (
                <button
                  type="button"
                  onClick={() => setRepoPath(defaultRoot)}
                  className="text-left text-xs text-accent hover:underline hover:text-accent-strong flex items-center gap-1 mt-1"
                >
                  <FolderIcon size={12} /> Use current project repo
                </button>
              )}
            </div>

            {/* Agent / CLI Dropdown */}
            <div className="flex flex-col gap-1.5" ref={dropdownRef}>
              <span className="text-xs font-medium tracking-wide text-muted">Agent CLI</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                  className="flex w-full items-center justify-between rounded-sm border border-border bg-panel px-3 py-2 text-sm text-content hover:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
                  aria-haspopup="listbox"
                  aria-expanded={agentDropdownOpen}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{cli}</span>
                    <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${getAgentBadgeClass(activeAgentStatus.badge)}`}>
                      {activeAgentStatus.badge}
                    </span>
                  </div>
                  <CaretDownIcon size={14} className="text-muted" />
                </button>
                {agentDropdownOpen && (
                  <div className="absolute z-10 mt-1 w-full rounded-sm border border-border bg-panel shadow-lg focus:outline-none" role="listbox">
                    <ul className="py-1 max-h-60 overflow-auto">
                      {AGENTS.map((ag) => {
                        const statusInfo = getAgentStatus(ag);
                        return (
                          <li key={ag} role="option" aria-selected={cli === ag}>
                            <button
                              type="button"
                              disabled={statusInfo.disabled && ag !== "fake"}
                              onClick={() => handleSelectAgent(ag)}
                              className={cn(
                                "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors",
                                cli === ag ? "bg-accent-soft text-accent" : "hover:bg-hover",
                                statusInfo.disabled && ag !== "fake" ? "opacity-50 cursor-not-allowed bg-raised/20" : ""
                              )}
                            >
                              <div className="flex flex-col">
                                <span className="font-medium">{ag}</span>
                                {statusInfo.reason && (
                                  <span className="text-[10px] text-faint font-normal">{statusInfo.reason}</span>
                                )}
                              </div>
                              <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${getAgentBadgeClass(statusInfo.badge)}`}>
                                {statusInfo.badge}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Prompt Area */}
            <div className="flex flex-col gap-2">
              <Field
                label="Instructions Prompt"
                hint={`${prompt.length} characters`}
              >
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  placeholder="Tell the agent what to do..."
                  className="font-mono text-xs"
                />
              </Field>

              {/* Prompt templates */}
              <div className="flex flex-col gap-1.5 mt-2">
                <span className="text-[11px] text-faint font-medium">Quick Templates:</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {promptTemplates.map((t, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setPrompt(t.text)}
                      className="text-left text-[11px] border border-border rounded-sm px-2 py-1.5 bg-panel hover:bg-hover hover:border-accent-strong transition-colors truncate"
                      title={t.text}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={resetPrompt}
                className="text-left text-xs text-muted hover:underline flex items-center gap-1 mt-1.5"
              >
                <ArrowCounterClockwiseIcon size={12} /> Reset default prompt
              </button>
            </div>

            {/* Action controls */}
            <div className="flex flex-col gap-2 mt-4 border-t border-border pt-4">
              <div className="flex gap-2">
                <Button
                  onClick={run}
                  disabled={runDisabled}
                  className={cn(
                    "flex-1 justify-center gap-2 py-2.5",
                    runDisabled ? "bg-faint/30 text-muted" : "bg-success hover:bg-success/90 text-white font-semibold"
                  )}
                >
                  {isRunning ? (
                    <CircleNotchIcon className="animate-spin" size={16} />
                  ) : (
                    <PlayIcon size={16} weight="fill" />
                  )}
                  {isRunning ? "Running..." : "Run Agent"}
                </Button>
                
                {isRunning && (
                  <Button
                    variant="danger"
                    onClick={cancelRun}
                    className="gap-2 px-3 py-2.5 bg-danger text-white hover:bg-danger/90"
                  >
                    <StopIcon size={16} weight="fill" />
                    Cancel
                  </Button>
                )}
              </div>

              <Button
                variant="ghost"
                disabled
                title="Browse is only available in desktop/Electron mode"
                className="w-full text-xs opacity-40 cursor-not-allowed justify-center gap-1.5 mt-1 border border-border"
              >
                <FolderIcon size={14} /> Open output folder
              </Button>
            </div>
          </div>

          {/* Right logs panel */}
          <div className="md:col-span-2 flex flex-col border border-border rounded-sm bg-panel overflow-hidden">
            
            {/* Header info */}
            <div className="bg-raised/40 p-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Run Outputs & Terminals</h3>
                <p className="text-xs text-muted mt-0.5">
                  Selected: <span className="font-semibold text-content">{cli}</span> @{" "}
                  <span className="font-mono text-[11px] text-content truncate max-w-[180px] inline-block align-middle" title={repoPath}>
                    {repoPath ? repoPath.slice(-25) : "none"}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${getStatusBadgeClass(status)}`}>
                  {status}
                </span>
              </div>
            </div>

            {/* Structured Tabs */}
            <div className="flex border-b border-border bg-raised/20 text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveTab("logs")}
                className={cn(
                  "px-4 py-3 border-b-2 transition-colors",
                  activeTab === "logs" ? "border-accent text-accent font-semibold bg-panel/30" : "border-transparent text-muted hover:text-content"
                )}
              >
                Agent Logs ({lines.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("patch")}
                className={cn(
                  "px-4 py-3 border-b-2 transition-colors relative",
                  activeTab === "patch" ? "border-accent text-accent font-semibold bg-panel/30" : "border-transparent text-muted hover:text-content"
                )}
              >
                Outputs & Patches
                {patchPreview && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-accent rounded-full" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("errors")}
                className={cn(
                  "px-4 py-3 border-b-2 transition-colors relative",
                  activeTab === "errors" ? "border-accent text-accent font-semibold bg-panel/30" : "border-transparent text-muted hover:text-content"
                )}
              >
                Errors & Diagnostics
                {(errorReason || warnings.length > 0) && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-danger rounded-full" />
                )}
              </button>
            </div>

            {/* Output screen */}
            <div className="flex-1 min-h-[380px] max-h-[500px] flex flex-col">
              
              {/* Logs tab */}
              {activeTab === "logs" && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div
                    ref={logRef}
                    className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-surface/40 leading-relaxed"
                  >
                    {lines.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-faint italic text-center">
                        Logs will stream here upon agent execution...
                      </div>
                    ) : (
                      lines.map((l, i) => (
                        <div key={i} className="flex gap-2 mb-1">
                          <span className="text-faint select-none">[{l.level}]</span>
                          <span className={colorFor(l.level)}>{l.text}</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Log panel toolbar */}
                  <div className="border-t border-border p-2 bg-raised/20 flex justify-between items-center text-xs">
                    <label className="flex items-center gap-2 text-muted select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoScroll}
                        onChange={(e) => setAutoScroll(e.target.checked)}
                        className="rounded-sm border-border bg-surface text-accent focus:ring-accent/30"
                      />
                      Auto-scroll
                    </label>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={copyLogs}
                        disabled={lines.length === 0}
                        className="flex items-center gap-1 border border-border rounded-sm bg-panel hover:bg-hover px-2 py-1 disabled:opacity-40"
                      >
                        <CopyIcon size={12} /> Copy
                      </button>
                      <button
                        type="button"
                        onClick={clearLogs}
                        disabled={lines.length === 0}
                        className="flex items-center gap-1 border border-border rounded-sm bg-panel hover:bg-hover px-2 py-1 text-danger disabled:opacity-40"
                      >
                        <TrashIcon size={12} /> Clear
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Patches tab */}
              {activeTab === "patch" && (
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-xs">
                  {outputSummary && (
                    <div className="border border-success/30 bg-success/5 rounded-sm p-3">
                      <h4 className="font-semibold text-success flex items-center gap-1.5">
                        <CheckIcon size={14} /> Output Summary
                      </h4>
                      <p className="mt-1 text-content font-mono">{outputSummary}</p>
                    </div>
                  )}

                  {filesChanged.length > 0 && (
                    <div className="border border-border bg-surface/20 rounded-sm p-3">
                      <h4 className="font-semibold flex items-center gap-1.5 text-muted mb-2">
                        <GitBranchIcon size={14} /> Files Changed
                      </h4>
                      <ul className="list-disc list-inside font-mono text-content flex flex-col gap-1 pl-1">
                        {filesChanged.map((file, i) => (
                          <li key={i}>{file}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {patchPreview ? (
                    <div className="flex-1 flex flex-col min-h-0 border border-border rounded-sm bg-surface/30">
                      <div className="bg-raised/35 px-3 py-2 border-b border-border font-medium flex items-center justify-between text-muted">
                        <span className="flex items-center gap-1"><FileCodeIcon size={13} /> Git Diff Preview</span>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(patchPreview)}
                          className="flex items-center gap-1 hover:text-content text-xs"
                        >
                          <CopyIcon size={12} /> Copy Diff
                        </button>
                      </div>
                      <pre className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-content whitespace-pre select-all bg-black/20">
                        {patchPreview}
                      </pre>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-faint italic py-16 text-center border border-dashed border-border rounded-sm">
                      No git patches/changes generated in this run.
                    </div>
                  )}
                </div>
              )}

              {/* Errors & Diagnostics tab */}
              {activeTab === "errors" && (
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-xs">
                  {errorReason ? (
                    <div className="border border-danger/30 bg-danger/5 rounded-sm p-4 text-danger">
                      <h4 className="font-semibold flex items-center gap-1.5">
                        <WarningIcon size={14} /> Execution Error
                      </h4>
                      <p className="mt-2 font-mono whitespace-pre-wrap leading-relaxed text-content">
                        {errorReason}
                      </p>
                    </div>
                  ) : (
                    <div className="border border-success/30 bg-success/5 rounded-sm p-4 text-success flex items-center gap-2">
                      <CheckIcon size={16} /> No execution errors reported.
                    </div>
                  )}

                  {warnings.length > 0 && (
                    <div className="border border-warning/30 bg-warning/5 rounded-sm p-4 text-warning">
                      <h4 className="font-semibold flex items-center gap-1.5 mb-2">
                        <WarningIcon size={14} /> Rule Warnings ({warnings.length})
                      </h4>
                      <ul className="list-disc list-inside font-mono text-content flex flex-col gap-1.5">
                        {warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

            </div>

          </div>
        </div>

      </div>
    </main>
  );
}
