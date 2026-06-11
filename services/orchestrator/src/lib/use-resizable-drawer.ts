"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDrawerPrefs,
  saveDrawerPrefs,
  clampDrawerHeight,
  DRAWER_MIN_HEIGHT,
  DRAWER_MAX_HEIGHT,
} from "@/lib/run-drawer-prefs";

export interface ResizableDrawer {
  /** Current expanded body height in px (always clamped). */
  height: number;
  /** Whether the drawer is minimized to its header bar. */
  collapsed: boolean;
  /** True while the user is actively dragging the resize handle. */
  isDragging: boolean;
  /** Props to spread on the top-edge drag handle element. */
  dragHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    role: "separator";
    "aria-orientation": "horizontal";
    "aria-label": string;
    "aria-valuenow": number;
    "aria-valuemin": number;
    "aria-valuemax": number;
    tabIndex: 0;
  };
  /** Toggle collapsed/expanded. */
  toggleCollapsed: () => void;
  /** Imperatively set collapsed state. */
  setCollapsed: (next: boolean) => void;
}

/** Keyboard resize step (px) when the handle is focused. */
const KEY_STEP = 24;

/**
 * Drag-to-resize + collapse state for the run drawer, persisted to localStorage.
 * The drawer is docked at the bottom, so dragging the top edge UP grows it.
 */
export function useResizableDrawer(): ResizableDrawer {
  // Lazy init from persisted prefs (SSR-safe: getDrawerPrefs guards `window`).
  const [{ height, collapsed }, setState] = useState(() => getDrawerPrefs());
  const [isDragging, setIsDragging] = useState(false);

  // Drag bookkeeping kept in refs so listeners don't churn.
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Persist whenever the settled values change.
  useEffect(() => {
    saveDrawerPrefs({ height, collapsed });
  }, [height, collapsed]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    // Docked at the bottom: moving up (smaller clientY) increases height.
    const delta = dragStartY.current - e.clientY;
    setState((prev) => ({
      ...prev,
      height: clampDrawerHeight(dragStartHeight.current + delta),
    }));
  }, []);

  const onPointerUp = useCallback(() => {
    setIsDragging(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragStartY.current = e.clientY;
      dragStartHeight.current = height;
      setIsDragging(true);
      // Expanding via drag implicitly un-collapses.
      setState((prev) => (prev.collapsed ? { ...prev, collapsed: false } : prev));
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [height, onPointerMove, onPointerUp],
  );

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setState((prev) => ({
        ...prev,
        collapsed: false,
        height: clampDrawerHeight(prev.height + KEY_STEP),
      }));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setState((prev) => ({
        ...prev,
        height: clampDrawerHeight(prev.height - KEY_STEP),
      }));
    }
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setState((prev) => ({ ...prev, collapsed: next }));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  // Clean up listeners if we unmount mid-drag.
  useEffect(
    () => () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  return {
    height,
    collapsed,
    isDragging,
    dragHandleProps: {
      onPointerDown,
      onKeyDown,
      role: "separator",
      "aria-orientation": "horizontal",
      "aria-label": "Resize run drawer",
      "aria-valuenow": height,
      "aria-valuemin": DRAWER_MIN_HEIGHT,
      "aria-valuemax": DRAWER_MAX_HEIGHT,
      tabIndex: 0,
    },
    toggleCollapsed,
    setCollapsed,
  };
}
