import { cn } from "@/lib/cn";

/**
 * Consistent empty-state block (icon + title + description + optional action),
 * reused across the dashboard, canvas, and run viewer so "nothing here yet"
 * always reads the same and offers a clear next action.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-accent-soft text-accent">
          {icon}
        </span>
      ) : null}
      <h2 className="mt-2 text-sm font-semibold tracking-tight text-content">
        {title}
      </h2>
      {description ? (
        <p className="max-w-xs text-sm text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
