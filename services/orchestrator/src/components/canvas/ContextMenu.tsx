"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { CopyIcon, SparkleIcon, TrashIcon } from "@phosphor-icons/react";

export interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
}

export interface EdgeContextMenuState {
  x: number;
  y: number;
  edgeId: string;
}

/**
 * Shared dismiss behavior for canvas popover menus: closes on outside click,
 * scroll, or Escape. Keeps the node and edge menus consistent.
 */
function useMenuDismiss(
  ref: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [ref, onClose]);
}

/**
 * Canvas right-click menu. Positioned at the pointer; closes on outside click,
 * scroll, or Escape. Built from primitives (Do-Not-Invent — no menu library).
 * Animation honors `prefers-reduced-motion` via the app-wide <MotionConfig>.
 */
export function ContextMenu({
  state,
  count,
  onDuplicate,
  onImproveSelected,
  onSpawnFixer,
  onDelete,
  onClose,
}: {
  state: ContextMenuState;
  count: number;
  onDuplicate: () => void;
  onImproveSelected?: () => void;
  onSpawnFixer: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useMenuDismiss(ref, onClose);

  const suffix = count > 1 ? ` ${count} nodes` : "";

  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label="Node actions"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      style={{ left: state.x, top: state.y }}
      className="fixed z-50 min-w-[168px] rounded-lg border border-border bg-overlay/95 p-1 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl"
    >
      <MenuItem icon={<CopyIcon size={14} />} onClick={onDuplicate}>
        Duplicate{suffix}
      </MenuItem>
      {onImproveSelected && (
        <MenuItem icon={<SparkleIcon size={14} weight="fill" />} onClick={onImproveSelected}>
          Improve selected with AI{suffix}
        </MenuItem>
      )}
      <MenuItem icon={<SparkleIcon size={14} weight="fill" />} onClick={onSpawnFixer}>
        Spawn fixer…
      </MenuItem>
      <div className="my-1 h-px bg-border" />
      <MenuItem icon={<TrashIcon size={14} />} danger onClick={onDelete}>
        Delete{suffix}
      </MenuItem>
    </motion.div>
  );
}

/**
 * Right-click menu for a single edge. Currently exposes "Delete edge"; kept as a
 * dedicated component so the node menu's API/markup stays untouched.
 */
export function EdgeContextMenu({
  state,
  onDelete,
  onClose,
}: {
  state: EdgeContextMenuState;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useMenuDismiss(ref, onClose);

  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label="Edge actions"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      style={{ left: state.x, top: state.y }}
      className="fixed z-50 min-w-[168px] rounded-lg border border-border bg-overlay/95 p-1 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl"
    >
      <MenuItem icon={<TrashIcon size={14} />} danger onClick={onDelete}>
        Delete edge
      </MenuItem>
    </motion.div>
  );
}

function MenuItem({
  icon,
  children,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-muted hover:bg-hover hover:text-content"
      }`}
    >
      <span className="grid h-4 w-4 place-items-center">{icon}</span>
      {children}
    </button>
  );
}
