"use client";

import { useId, useState, type ReactElement } from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal, dependency-free tooltip (minimalist-ui §popovers). Wraps a single
 * interactive trigger and reveals a short text label on hover AND keyboard
 * focus, so the label is discoverable without a mouse.
 *
 * Accessibility:
 *  - the floating label gets `role="tooltip"` + a stable id, and the trigger is
 *    linked to it via `aria-describedby` so screen readers announce it;
 *  - the trigger keeps its own `aria-label` for the accessible *name*.
 * Reduced-motion: the fade is a CSS transition that collapses under the global
 * `prefers-reduced-motion` rule in globals.css.
 */
export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: {
  label: string;
  /** A single focusable/hoverable trigger element (e.g. a <button>). */
  children: ReactElement;
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {/* Trigger — described by the floating label for assistive tech. */}
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        // Hidden from the a11y tree until shown so it isn't double-announced.
        aria-hidden={!open}
        className={cn(
          "pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap",
          "rounded-xs border border-border bg-overlay px-2 py-1",
          "text-[11px] font-medium tracking-tight text-content shadow-lg",
          "transition-opacity duration-150 ease-out",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          open ? "opacity-100" : "opacity-0",
          className,
        )}
      >
        {label}
      </span>
    </span>
  );
}
