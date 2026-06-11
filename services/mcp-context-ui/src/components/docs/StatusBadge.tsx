/**
 * StatusBadge — Green/red/yellow status indicators for service health.
 */
import { cn } from "../../lib/utils";

type StatusVariant = "success" | "error" | "warning" | "loading";

interface StatusBadgeProps {
  variant: StatusVariant;
  label: string;
  className?: string;
}

const variantStyles: Record<StatusVariant, string> = {
  success: "bg-success-50 text-success-600 border-success-500/30",
  error: "bg-danger-50 text-danger-600 border-danger-500/30",
  warning: "bg-warning-50 text-warning-500 border-warning-500/30",
  loading: "bg-slate-50 text-slate-500 border-slate-300",
};

const dotStyles: Record<StatusVariant, string> = {
  success: "bg-success-500",
  error: "bg-danger-500",
  warning: "bg-warning-500",
  loading: "bg-slate-400 animate-pulse",
};

export function StatusBadge({ variant, label, className }: StatusBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
        variantStyles[variant],
        className
      )}
      role="status"
      aria-label={label}
    >
      <span className={cn("h-2 w-2 rounded-full", dotStyles[variant])} aria-hidden="true" />
      {label}
    </div>
  );
}
