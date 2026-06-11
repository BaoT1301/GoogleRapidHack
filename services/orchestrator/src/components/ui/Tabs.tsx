"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  /** Stable identifier for the tab. */
  id: string;
  /** Visible label. */
  label: ReactNode;
  /** Panel content rendered when the tab is active. */
  content: ReactNode;
}

/**
 * Reusable, accessible tab strip (WAI-ARIA tabs pattern):
 *   - `role="tablist"` / `role="tab"` / `role="tabpanel"` with `aria-selected`,
 *     `aria-controls`, and `id`/`aria-labelledby` wiring.
 *   - Roving tabindex: only the active tab is in the tab order; ArrowLeft/Right
 *     (+ Home/End) move selection and focus between tabs.
 *   - Only the active panel is mounted, so heavy sections (live queries) don't
 *     all fetch at once.
 *
 * Controlled or uncontrolled: pass `value`/`onValueChange` to control, or omit
 * for internal state seeded by `defaultValue` (falls back to the first tab).
 */
export function Tabs({
  tabs,
  value,
  defaultValue,
  onValueChange,
  ariaLabel,
  className,
}: {
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.id);
  const active = value ?? internal;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    const nextTab = tabs[next];
    if (!nextTab) return;
    select(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {tabs.map((t, i) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "relative -mb-px rounded-t-sm px-3 py-2 text-xs font-medium tracking-wide",
                "transition-colors duration-200 focus-visible:outline-none",
                "focus-visible:ring-2 focus-visible:ring-accent/40",
                selected
                  ? "border-b-2 border-accent text-content"
                  : "border-b-2 border-transparent text-faint hover:text-muted",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeTab.id}`}
          aria-labelledby={`${baseId}-tab-${activeTab.id}`}
          tabIndex={0}
          className="focus-visible:outline-none"
        >
          {activeTab.content}
        </div>
      ) : null}
    </div>
  );
}
