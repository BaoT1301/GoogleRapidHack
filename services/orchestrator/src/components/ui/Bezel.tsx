import { cn } from "@/lib/cn";

/**
 * Double-Bezel card (high-end-visual-design §4A): an outer hairline shell with
 * a small inner radius offset, wrapping an inner core surface. Used for panels,
 * dialogs, and dashboard cards so containers read as machined hardware.
 */
export function Bezel({
  className,
  innerClassName,
  children,
}: {
  className?: string;
  innerClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-raised p-1.5",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-md bg-panel-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
