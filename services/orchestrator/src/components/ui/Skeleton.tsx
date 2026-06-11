import { cn } from "@/lib/cn";

/**
 * Pulsing placeholder used while data is loading, instead of rendering
 * misleading defaults (e.g. "Not configured" before a query resolves).
 *
 * Accessibility / motion:
 *   - `aria-hidden` + `role="presentation"` — purely decorative; the loading
 *     state is communicated by the surrounding region's `aria-busy`.
 *   - The pulse animation collapses under `prefers-reduced-motion` (globals.css
 *     reduced-motion rule + the explicit `motion-reduce:animate-none` guard).
 */
export function Skeleton({
  className,
  rounded = "sm",
}: {
  className?: string;
  /** Corner radius token; `full` for circular avatars/dots. */
  rounded?: "sm" | "md" | "full";
}) {
  const radius =
    rounded === "full"
      ? "rounded-full"
      : rounded === "md"
        ? "rounded-md"
        : "rounded-sm";
  return (
    <span
      role="presentation"
      aria-hidden
      data-testid="skeleton"
      className={cn(
        "block animate-pulse bg-elevated motion-reduce:animate-none",
        radius,
        className,
      )}
    />
  );
}

/**
 * Convenience: a stack of N text-line skeletons (last line shortened) for the
 * common "loading a paragraph / list" case.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span
      role="presentation"
      aria-hidden
      data-testid="skeleton-text"
      className={cn("flex flex-col gap-2", className)}
    >
      {Array.from({ length: Math.max(1, lines) }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </span>
  );
}
