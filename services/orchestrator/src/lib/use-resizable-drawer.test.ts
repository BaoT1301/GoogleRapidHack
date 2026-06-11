// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useResizableDrawer } from "./use-resizable-drawer";
import {
  getDrawerPrefs,
  saveDrawerPrefs,
  DRAWER_DEFAULT_HEIGHT,
  DRAWER_MIN_HEIGHT,
  DRAWER_MAX_HEIGHT,
} from "./run-drawer-prefs";

/** Minimal React.PointerEvent stand-in for the handler. */
function pointer(clientY: number) {
  return { clientY, preventDefault() {} } as unknown as React.PointerEvent;
}
function key(k: string) {
  return { key: k, preventDefault() {} } as unknown as React.KeyboardEvent;
}

describe("useResizableDrawer", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("initializes from persisted prefs", () => {
    saveDrawerPrefs({ height: 420, collapsed: true });
    const { result } = renderHook(() => useResizableDrawer());
    expect(result.current.height).toBe(420);
    expect(result.current.collapsed).toBe(true);
  });

  it("defaults when nothing is persisted", () => {
    const { result } = renderHook(() => useResizableDrawer());
    expect(result.current.height).toBe(DRAWER_DEFAULT_HEIGHT);
    expect(result.current.collapsed).toBe(false);
  });

  it("grows when dragging the top edge upward", () => {
    const { result } = renderHook(() => useResizableDrawer());
    act(() => result.current.dragHandleProps.onPointerDown(pointer(500)));
    expect(result.current.isDragging).toBe(true);
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientY: 400 })));
    // start 288 + (500 - 400) = 388
    expect(result.current.height).toBe(388);
    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(result.current.isDragging).toBe(false);
  });

  it("clamps the dragged height to the max", () => {
    const { result } = renderHook(() => useResizableDrawer());
    act(() => result.current.dragHandleProps.onPointerDown(pointer(1000)));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientY: 0 })));
    expect(result.current.height).toBe(DRAWER_MAX_HEIGHT);
  });

  it("persists the height after a drag", () => {
    const { result } = renderHook(() => useResizableDrawer());
    act(() => result.current.dragHandleProps.onPointerDown(pointer(500)));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientY: 450 })));
    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(getDrawerPrefs().height).toBe(338);
  });

  it("toggles collapsed and persists it", () => {
    const { result } = renderHook(() => useResizableDrawer());
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(true);
    expect(getDrawerPrefs().collapsed).toBe(true);
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(false);
  });

  it("dragging un-collapses the drawer", () => {
    saveDrawerPrefs({ height: 300, collapsed: true });
    const { result } = renderHook(() => useResizableDrawer());
    act(() => result.current.dragHandleProps.onPointerDown(pointer(500)));
    expect(result.current.collapsed).toBe(false);
  });

  it("resizes with arrow keys and clamps at the min", () => {
    saveDrawerPrefs({ height: DRAWER_MIN_HEIGHT, collapsed: false });
    const { result } = renderHook(() => useResizableDrawer());
    act(() => result.current.dragHandleProps.onKeyDown(key("ArrowDown")));
    expect(result.current.height).toBe(DRAWER_MIN_HEIGHT);
    act(() => result.current.dragHandleProps.onKeyDown(key("ArrowUp")));
    expect(result.current.height).toBe(DRAWER_MIN_HEIGHT + 24);
  });
});
