"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { ulid } from "ulid";
import { CheckIcon, CircleNotchIcon, PlayIcon, SparkleIcon, StopIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { Canvas } from "@/components/canvas/Canvas";
import {
  ContextMenu,
  EdgeContextMenu,
  type ContextMenuState,
  type EdgeContextMenuState,
} from "@/components/canvas/ContextMenu";
import { SpawnFixerModal } from "@/components/canvas/SpawnFixerModal";
import { ImproveSelectedNodesModal } from "@/components/canvas/ImproveSelectedNodesModal";
import { applySubgraphPatchToCanvas, type CanvasSubgraphPatch } from "@/components/canvas/graphPatch";
import {
  createUndoSnapshot,
  popUndoSnapshot,
  pushUndoSnapshot,
  type CanvasUndoSnapshot,
} from "@/components/canvas/undoStack";
import {
  selectionIds,
  contextTargets,
  duplicateNodes,
} from "@/components/canvas/selection";
import {
  resolveShortcut,
  isEditableTarget,
} from "@/lib/canvas-shortcuts";
import { Inspector, type NodePatch } from "@/components/canvas/Inspector";
import { PlanPanel } from "@/components/canvas/PlanPanel";
import { PlanLedger } from "@/components/canvas/PlanLedger";
import { RunDrawer } from "@/components/run/RunDrawer";
import { useRunController } from "@/components/run/useRunController";
import { ChildRunPanel } from "@/components/run/ChildRunPanel";
import {
  flowToSpec,
  specToFlow,
  toMinEdges,
  type AppNode,
  type AppEdge,
  type FlowEdgeData,
} from "@/components/canvas/serialize";
import { getLastUsedAgent } from "@/lib/last-used-agent";
import { KIND_META } from "@/lib/graph-constants";
import { specKey } from "@/lib/graph-dirty";
import { computeInputHashes, deriveVisualStates } from "@/lib/node-visual-state";
import { validateConnection } from "@/lib/graph-validation";
import type { INodeSpec, IEdgeSpec, NodeKind } from "@/db/models/graph.model";

type SaveState = "saved" | "saving" | "dirty";

export function WorkspaceEditor({
  graphId,
  initialNodes,
  initialEdges,
  defaultPersona,
  rootRepoPath,
  planId,
  onSave,
}: {
  graphId: string;
  initialNodes: AppNode[];
  initialEdges: AppEdge[];
  defaultPersona?: string;
  rootRepoPath?: string;
  /** PLAN-5: when this graph belongs to a multi-sprint plan, show the live ledger. */
  planId?: string;
  onSave: (spec: { nodes: INodeSpec[]; edges: IEdgeSpec[] }) => Promise<unknown>;
}) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>(initialEdges);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<EdgeContextMenuState | null>(null);
  const [spawnFixerNodeId, setSpawnFixerNodeId] = useState<string | null>(null);
  const [improveOpen, setImproveOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<CanvasUndoSnapshot[]>([]);
  const [childRun, setChildRun] = useState<{ runId: string; label: string } | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const first = useRef(true);
  // Smart Run/Stop handler, kept in a ref so the keyboard shortcut effect can
  // call the latest version without re-binding listeners every render.
  const runActionRef = useRef<() => void>(() => {});
  const hasRepoPath = Boolean(rootRepoPath);
  // Content key of the last persisted graph. We only mark dirty / save when the
  // authored spec actually changes — selection, dimension measurement and live
  // run status updates no longer flip the badge (fixes Saved/Unsaved flicker).
  const lastSavedKey = useRef(specKey(initialNodes, initialEdges));

  // VIS: per-node input-hash baseline captured at the last run launch. The
  // derived `stale` visual is computed against this (see node-visual-state). A
  // ref (not persisted, not in specKey) so it never affects the authored graph
  // or the save badge; `baselineVersion` bumps to make the derivation reactive.
  const runBaselineRef = useRef<Record<string, string> | null>(null);
  const [baselineVersion, setBaselineVersion] = useState(0);

  const personasQuery = useQuery(
    trpc.templates.list.queryOptions({ kind: "persona" }),
  );
  const applyAiPatch = useMutation(trpc.ai.applySubgraphPatch.mutationOptions());
  const applyPlanProposal = useMutation(trpc.graphs.applyPlanNodeProposal.mutationOptions());
  const personas = useMemo(
    () =>
      (personasQuery.data ?? []).map((t: { id: string; name: string }) => ({
        id: t.id,
        name: t.name,
      })),
    [personasQuery.data],
  );

  // Force an immediate save (used before a run so the snapshot is current).
  const flushSave = useCallback(async () => {
    clearTimeout(timer.current);
    // Capture the input-hash baseline for this run; subsequent authoring edits
    // that change a node's inputs will mark a prior success `stale` (visual-only).
    runBaselineRef.current = computeInputHashes(nodes, edges);
    setBaselineVersion((v) => v + 1);
    setSaveState("saving");
    try {
      await onSave(flowToSpec(nodes, edges));
      lastSavedKey.current = specKey(nodes, edges);
      setSaveState("saved");
    } catch {
      setSaveState("dirty");
    }
  }, [nodes, edges, onSave]);

  // Debounced (~1000 ms) persistence after hydration. Content-diff gated: a
  // change that doesn't alter the authored spec (selection, dimensions, live
  // run status) is a no-op, so the save badge never flickers.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const key = specKey(nodes, edges);
    if (key === lastSavedKey.current) return; // nothing authored changed
    setSaveState("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaveState("saving");
      const savingKey = specKey(nodes, edges);
      onSave(flowToSpec(nodes, edges))
        .then(() => {
          lastSavedKey.current = savingKey;
          setSaveState("saved");
        })
        .catch(() => {
          setSaveState("dirty");
          toast("Failed to save graph", "error");
        });
    }, 1000);
    return () => clearTimeout(timer.current);
  }, [nodes, edges, onSave, toast]);

  const onConnect = useCallback(
    (conn: Connection) => {
      const v = validateConnection(
        { source: conn.source, target: conn.target, kind: "flow" },
        toMinEdges(edges),
      );
      if (!v.ok) {
        toast(v.reason ?? "Invalid connection", "error");
        return;
      }
      setEdges((eds) =>
        addEdge<AppEdge>(
          {
            ...conn,
            id: ulid(),
            // Stroke/animation are applied from the active Theme Pack in Canvas
            // (edgeRenderProps), so a new edge re-skins with the theme too.
            data: { kind: "flow" } as FlowEdgeData,
          },
          eds,
        ),
      );
    },
    [edges, setEdges, toast],
  );

  const isValidConnection = useCallback(
    (conn: Connection | Edge) =>
      validateConnection(
        { source: conn.source, target: conn.target, kind: "flow" },
        toMinEdges(edges),
      ).ok,
    [edges],
  );

  const onAddNode = useCallback(
    (kind: NodeKind) => {
      const data: Record<string, unknown> = {};
      if (kind === "execute") {
        data.baseRef = "HEAD";
        data.cli = getLastUsedAgent() ?? "codex";
        if (defaultPersona) data.persona = defaultPersona;
      }
      const node: AppNode = {
        id: ulid(),
        type: "graphNode",
        position: { x: 120 + Math.random() * 80, y: 120 + Math.random() * 80 },
        data: { kind, label: KIND_META[kind].label, status: "pending", data },
      };
      onNodesChange([{ type: "add", item: node }]);
    },
    [defaultPersona, onNodesChange],
  );

  const onSelectionChange = useCallback((p: OnSelectionChangeParams) => {
    setSelectedIds(selectionIds(p.nodes));
    setSelectedEdgeIds(p.edges.map((e) => e.id));
  }, []);

  // Keyboard shortcuts — scoped so they never fire while typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = resolveShortcut(e, isEditableTarget(e.target));
      if (!action) return;
      if (action === "delete") {
        if (selectedIds.length === 0 && selectedEdgeIds.length === 0) return;
        onNodesChange(selectedIds.map((id) => ({ type: "remove", id })));
        onEdgesChange(selectedEdgeIds.map((id) => ({ type: "remove", id })));
      } else if (action === "select-all") {
        e.preventDefault();
        setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
        setSelectedIds(nodes.map((n) => n.id));
      } else if (action === "run") {
        e.preventDefault();
        runActionRef.current();
      } else if (action === "escape") {
        setMenu(null);
        setEdgeMenu(null);
        setSpawnFixerNodeId(null);
        setPlanOpen(false);
        setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
        setSelectedIds([]);
        setSelectedEdgeIds([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds, selectedEdgeIds, nodes, onNodesChange, onEdgesChange, setNodes]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setEdgeMenu(null);
  }, []);

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: AppNode) => {
      e.preventDefault();
      setEdgeMenu(null);
      setMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
    },
    [],
  );

  const setHoverState = useCallback(
    (nodeId: string, hovered: boolean) => {
      setNodes((ns) =>
        ns.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, hovered } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const onNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: AppNode) => setHoverState(node.id, true),
    [setHoverState],
  );

  const onNodeMouseLeave = useCallback(
    (_event: React.MouseEvent, node: AppNode) => setHoverState(node.id, false),
    [setHoverState],
  );

  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: AppEdge) => {
      e.preventDefault();
      setMenu(null);
      setEdgeMenu({ x: e.clientX, y: e.clientY, edgeId: edge.id });
    },
    [],
  );

  const handleDuplicate = useCallback(() => {
    if (!menu) return;
    const ids = contextTargets(menu.nodeId, selectedIds);
    const clones = duplicateNodes(nodes, ids);
    onNodesChange(clones.map((item) => ({ type: "add", item })));
    setMenu(null);
  }, [menu, selectedIds, nodes, onNodesChange]);

  const handleDelete = useCallback(() => {
    if (!menu) return;
    const ids = contextTargets(menu.nodeId, selectedIds);
    onNodesChange(ids.map((id) => ({ type: "remove", id })));
    setMenu(null);
  }, [menu, selectedIds, onNodesChange]);

  const handleDeleteEdge = useCallback(() => {
    if (!edgeMenu) return;
    onEdgesChange([{ type: "remove", id: edgeMenu.edgeId }]);
    setEdgeMenu(null);
  }, [edgeMenu, onEdgesChange]);

  const handleSpawnFixer = useCallback(() => {
    if (!menu) return;
    setSpawnFixerNodeId(menu.nodeId);
    setMenu(null);
  }, [menu]);

  const handleImproveSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setImproveOpen(true);
    setMenu(null);
  }, [selectedIds.length]);

  const updateNode = useCallback(
    (id: string, patch: NodePatch) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  ...(patch.label !== undefined ? { label: patch.label } : {}),
                  ...(patch.data
                    ? { data: { ...n.data.data, ...patch.data } }
                    : {}),
                },
              }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const selectedNode =
    selectedIds.length === 1
      ? (nodes.find((n) => n.id === selectedIds[0]) ?? null)
      : null;

  const selectedNodesForImprove = useMemo(
    () => nodes.filter((node) => selectedIds.includes(node.id)),
    [nodes, selectedIds],
  );

  const setGeneratingGlow = useCallback(
    (generating: boolean) => {
      const selected = new Set(selectedIds);
      setNodes((ns) =>
        ns.map((node) =>
          selected.has(node.id)
            ? { ...node, data: { ...node.data, aiPulsing: generating } }
            : node,
        ),
      );
    },
    [selectedIds, setNodes],
  );

  useEffect(() => {
    if (!improveOpen || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    setNodes((ns) =>
      ns.map((node) =>
        selected.has(node.id)
          ? { ...node, data: { ...node.data, aiPulsing: true } }
          : node,
      ),
    );
    const pulseTimer = window.setTimeout(() => {
      setNodes((ns) =>
        ns.map((node) =>
          selected.has(node.id)
            ? { ...node, data: { ...node.data, aiPulsing: false } }
            : node,
        ),
      );
    }, 700);
    return () => window.clearTimeout(pulseTimer);
  }, [improveOpen, selectedIds, setNodes]);

  const markPatchAnimation = useCallback(
    (patch: {
      changedNodeIds: string[];
      addedNodeIds: string[];
      removedNodeIds: string[];
      changedEdgeIds: string[];
      addedEdgeIds: string[];
      removedEdgeIds: string[];
    }) => {
      const changed = new Set(patch.changedNodeIds);
      const added = new Set(patch.addedNodeIds);
      const removed = new Set(patch.removedNodeIds);
      const changedEdges = new Set(patch.changedEdgeIds);
      const addedEdges = new Set(patch.addedEdgeIds);
      const removedEdges = new Set(patch.removedEdgeIds);
      setNodes((ns) =>
        ns.map((node) => ({
          ...node,
          data: {
            ...node.data,
            aiPulsing: false,
            aiPatchState: added.has(node.id)
              ? "added"
              : removed.has(node.id)
                ? "removed"
                : changed.has(node.id)
                  ? "changed"
                  : undefined,
          },
        })),
      );
      setEdges((es) =>
        es.map((edge) => ({
          ...edge,
          data: {
            ...(edge.data ?? { kind: "flow" }),
            aiPatchState: addedEdges.has(edge.id)
              ? "added"
              : removedEdges.has(edge.id)
                ? "removed"
                : changedEdges.has(edge.id)
                  ? "changed"
                  : undefined,
          },
        })),
      );
      window.setTimeout(() => {
        setNodes((ns) =>
          ns.map((node) => ({
            ...node,
            data: { ...node.data, aiPatchState: undefined, aiPulsing: false },
          })),
        );
      }, 1800);
      window.setTimeout(() => {
        setEdges((es) =>
          es.map((edge) => ({
            ...edge,
            data: { ...(edge.data ?? { kind: "flow" }), aiPatchState: undefined },
          })),
        );
      }, 1800);
    },
    [setEdges, setNodes],
  );

  const applyAiProposal = useCallback(
    async (proposal: {
      proposalId: string;
      patch: CanvasSubgraphPatch;
    }) => {
      const localPreview = applySubgraphPatchToCanvas({
        nodes,
        edges,
        patch: proposal.patch,
      });
      const snapshot = createUndoSnapshot({
        nodes,
        edges,
        proposalId: proposal.proposalId,
      });
      const updated = await applyAiPatch.mutateAsync({
        graphId,
        proposalId: proposal.proposalId,
        confirm: true,
      });
      setUndoStack((stack) => pushUndoSnapshot(stack, snapshot));
      const flow = specToFlow(updated.nodes as INodeSpec[], updated.edges as IEdgeSpec[]);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      markPatchAnimation(localPreview);
    },
    [applyAiPatch, edges, graphId, markPatchAnimation, nodes, setEdges, setNodes],
  );

  const undoAiChange = useCallback(async () => {
    const result = popUndoSnapshot({
      stack: undoStack,
      currentNodes: nodes,
      currentEdges: edges,
    });
    if (!result.undo) {
      toast("No AI change to undo", "info");
      return;
    }
    setUndoStack(result.stack);
    setSaveState("saving");
    setNodes(result.undo.nodes);
    setEdges(result.undo.edges);
    markPatchAnimation(result.undo);
    try {
      await onSave(flowToSpec(result.undo.nodes, result.undo.edges));
      setSaveState("saved");
      toast("Canvas restored to previous state.", "success");
    } catch {
      setSaveState("dirty");
      toast("Undo restored locally, but saving failed.", "error");
    }
  }, [edges, markPatchAnimation, nodes, onSave, setEdges, setNodes, toast, undoStack]);

  const applyPlan = useCallback(
    (spec: { nodes: INodeSpec[]; edges: IEdgeSpec[] }) => {
      const flow = specToFlow(spec.nodes, spec.edges);
      // Additive apply — a Generate result is layered onto the canvas as a fresh
      // subgraph and never clobbers existing work (Q4). Re-id so repeated applies
      // can't collide, offset below current content, and select the new nodes.
      const idMap = new Map<string, string>();
      flow.nodes.forEach((n) => idMap.set(n.id, ulid()));
      const offsetY =
        nodes.reduce((m, n) => Math.max(m, n.position.y), 0) +
        (nodes.length ? 220 : 0);
      const newNodes: AppNode[] = flow.nodes.map((n) => ({
        ...n,
        id: idMap.get(n.id) as string,
        position: { x: n.position.x, y: n.position.y + offsetY },
        selected: true,
      }));
      const newEdges: AppEdge[] = flow.edges.map((e) => ({
        ...e,
        id: ulid(),
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
      }));
      setNodes((ns) => [
        ...ns.map((n) => ({ ...n, selected: false })),
        ...newNodes,
      ]);
      setEdges((es) => [...es, ...newEdges]);
    },
    [nodes, setNodes, setEdges],
  );

  const executeNodes = nodes
    .filter((n) => n.data.kind === "execute")
    .map((n) => ({ id: n.id, label: n.data.label }));

  // UI-DERIVED visual statuses (currently `stale`) computed against the run
  // baseline. Pure + non-persisted: we never write `visualStatus` back into the
  // authored `nodes` state, so specKey/the save badge are unaffected. Instead we
  // render a derived COPY (`displayNodes`) that carries `data.visualStatus`.
  const derivedStatuses = useMemo(
    () => deriveVisualStates(nodes, edges, runBaselineRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref read; bump via baselineVersion
    [nodes, edges, baselineVersion],
  );

  const displayNodes = useMemo(() => {
    if (Object.keys(derivedStatuses).length === 0) return nodes;
    return nodes.map((n) => {
      const vs = derivedStatuses[n.id];
      return vs ? { ...n, data: { ...n.data, visualStatus: vs } } : n;
    });
  }, [nodes, derivedStatuses]);

  // Live per-node status from the run viewer's SSE stream → colour the canvas.
  const applyNodeStatuses = useCallback(
    (statuses: Record<string, string>) => {
      if (Object.keys(statuses).length === 0) return;
      setNodes((ns) =>
        ns.map((n) =>
          statuses[n.id] && statuses[n.id] !== n.data.status
            ? { ...n, data: { ...n.data, status: statuses[n.id] as AppNode["data"]["status"] } }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const applyNodePlanStates = useCallback(
    (statuses: Record<string, string>) => {
      if (Object.keys(statuses).length === 0) return;
      setNodes((ns) =>
        ns.map((n) =>
          statuses[n.id]
            ? { ...n, data: { ...n.data, planState: statuses[n.id] } }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const applyNodeElapsedLabels = useCallback(
    (labels: Record<string, string>) => {
      setNodes((ns) =>
        ns.map((n) => {
          const nextLabel = labels[n.id];
          const currentLabel = n.data.runtimeLabel;
          if (nextLabel === currentLabel) return n;
          if (!nextLabel && !currentLabel) return n;
          return {
            ...n,
            data: {
              ...n.data,
              runtimeLabel: nextLabel,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const applyPlanNodeProposal = useCallback(
    async ({ runId, nodeId }: { runId: string; nodeId: string }) => {
      const snapshot = createUndoSnapshot({
        nodes,
        edges,
        proposalId: `plan:${runId}:${nodeId}`,
      });
      const updated = await applyPlanProposal.mutateAsync({
        graphId,
        runId,
        nodeId,
        confirm: true,
        mode: "append",
      });
      setUndoStack((stack) => pushUndoSnapshot(stack, snapshot));
      const flow = specToFlow(updated.nodes as INodeSpec[], updated.edges as IEdgeSpec[]);
      const beforeNodeIds = new Set(nodes.map((node) => node.id));
      const beforeEdgeIds = new Set(edges.map((edge) => edge.id));
      setNodes(flow.nodes);
      setEdges(flow.edges);
      markPatchAnimation({
        changedNodeIds: [],
        addedNodeIds: flow.nodes.filter((node) => !beforeNodeIds.has(node.id)).map((node) => node.id),
        removedNodeIds: [],
        changedEdgeIds: [],
        addedEdgeIds: flow.edges.filter((edge) => !beforeEdgeIds.has(edge.id)).map((edge) => edge.id),
        removedEdgeIds: [],
      });
      toast("Plan proposal applied.", "success");
    },
    [applyPlanProposal, edges, graphId, markPatchAnimation, nodes, setEdges, setNodes, toast],
  );

  // Shared run orchestration — consumed by both the header Run/Stop button and
  // the RunDrawer so they reflect the same live state.
  const runController = useRunController({
    graphId,
    executeNodes,
    hasRepoPath,
    panelOpen: runOpen,
    onBeforeRun: flushSave,
    onNodeStatuses: applyNodeStatuses,
    onNodePlanStates: applyNodePlanStates,
    onNodeElapsedLabels: applyNodeElapsedLabels,
    onApplyPlanProposal: applyPlanNodeProposal,
  });

  // Smart toggle: while running → confirm stop; otherwise open the drawer and,
  // when the graph can run, launch immediately (no second "Start run" click).
  const handleRunButton = useCallback(() => {
    if (runController.isRunning) {
      runController.openStopConfirm();
      return;
    }
    setRunOpen(true);
    if (hasRepoPath && !runController.isStarting) {
      runController.startRealRun();
    }
  }, [runController, hasRepoPath]);
  runActionRef.current = handleRunButton;

  // Guidance when the graph has no repo path yet (drawer empty-state action).
  const handleRequestSetRepoPath = useCallback(() => {
    toast(
      "Set this graph's repo path in its settings to run agents against a repository.",
      "info",
    );
  }, [toast]);

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-panel px-4 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Canvas
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPlanOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs font-medium text-content transition-colors hover:border-border-strong hover:bg-hover"
            >
              <SparkleIcon size={13} weight="fill" /> Generate
            </button>
            <button
              onClick={handleRunButton}
              aria-label={runController.isRunning ? "Stop run" : "Run"}
              title={
                runController.isRunning
                  ? "Stop the active run"
                  : hasRepoPath
                    ? "Run this graph (⌘↵)"
                    : "Opens the run drawer — set a repo path to launch"
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors",
                runController.isRunning
                  ? "border-danger/40 bg-transparent text-danger hover:bg-danger/10"
                  : "border-transparent bg-accent text-on-accent hover:bg-accent-strong",
              )}
            >
              {runController.isRunning ? (
                <>
                  <StopIcon size={13} weight="fill" /> Stop
                </>
              ) : runController.isStarting ? (
                <>
                  <CircleNotchIcon size={13} className="animate-spin" /> Starting…
                </>
              ) : (
                <>
                  <PlayIcon size={13} weight="fill" /> Run
                </>
              )}
            </button>
            <div className="ml-1 border-l border-border pl-3">
              <SaveBadge state={saveState} />
            </div>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <Canvas
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onAddNode={onAddNode}
            onSelectionChange={onSelectionChange}
            onNodeContextMenu={onNodeContextMenu}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneClick={closeMenu}
          />
          {menu && (
            <ContextMenu
              state={menu}
              count={contextTargets(menu.nodeId, selectedIds).length}
              onDuplicate={handleDuplicate}
              onImproveSelected={handleImproveSelected}
              onSpawnFixer={handleSpawnFixer}
              onDelete={handleDelete}
              onClose={closeMenu}
            />
          )}
          {edgeMenu && (
            <EdgeContextMenu
              state={edgeMenu}
              onDelete={handleDeleteEdge}
              onClose={() => setEdgeMenu(null)}
            />
          )}
          {planId && (
            <div className="absolute left-4 top-4 z-10">
              <PlanLedger planId={planId} />
            </div>
          )}
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
            {selectedIds.length > 0 && (
              <button
                onClick={handleImproveSelected}
                className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent backdrop-blur-xl transition-colors hover:border-accent/70"
              >
                <SparkleIcon size={12} weight="fill" /> Improve selected with AI ({selectedIds.length})
              </button>
            )}
            {undoStack.length > 0 && (
              <button
                onClick={undoAiChange}
                className="flex items-center gap-1.5 rounded-full border border-border bg-panel/80 px-3 py-1 text-[11px] font-medium text-content backdrop-blur-xl transition-colors hover:border-border-strong"
              >
                Undo AI change
              </button>
            )}
          </div>
        </div>
        {runOpen && (
          <RunDrawer
            controller={runController}
            hasRepoPath={hasRepoPath}
            onRequestSetRepoPath={handleRequestSetRepoPath}
            onClose={() => setRunOpen(false)}
          />
        )}
      </div>
      <Inspector node={selectedNode} personas={personas} onUpdate={updateNode} graphId={graphId} />
      <PlanPanel
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        onApply={applyPlan}
        rootRepoPath={rootRepoPath}
      />
      <ImproveSelectedNodesModal
        open={improveOpen}
        graphId={graphId}
        selectedNodes={selectedNodesForImprove}
        onClose={() => {
          setImproveOpen(false);
          setGeneratingGlow(false);
        }}
        onGeneratingChange={setGeneratingGlow}
        onApplyProposal={applyAiProposal}
      />
      <SpawnFixerModal
        open={spawnFixerNodeId !== null}
        graphId={graphId}
        parentNodeId={spawnFixerNodeId}
        selectedCount={selectedIds.length}
        selectedNodeIds={spawnFixerNodeId ? [spawnFixerNodeId] : selectedIds}
        defaultPersona={defaultPersona}
        onSpawnedRun={(runId, label) => {
          setChildRun({ runId, label });
          setSpawnFixerNodeId(null);
        }}
        onClose={() => setSpawnFixerNodeId(null)}
      />
      {childRun && (
        <ChildRunPanel
          runId={childRun.runId}
          label={childRun.label}
          onClose={() => setChildRun(null)}
        />
      )}
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const map = {
    saved: { label: "Saved", className: "text-success" },
    saving: { label: "Saving…", className: "text-warning" },
    dirty: { label: "Unsaved", className: "text-faint" },
  }[state];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-panel/80 px-3 py-1 text-[11px] font-medium backdrop-blur-xl",
        map.className,
      )}
    >
      {state === "saving" ? (
        <CircleNotchIcon size={12} className="animate-spin" />
      ) : state === "saved" ? (
        <CheckIcon size={12} />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {map.label}
    </div>
  );
}
