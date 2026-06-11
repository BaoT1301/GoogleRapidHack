import { statusColor } from "@/lib/status";
import { cn } from "@/lib/cn";

/** Uppercase, wide-tracked status pill (minimalist-ui §5 tags). */
export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const color = statusColor(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5",
        "text-[10px] font-medium uppercase tracking-[0.12em]",
        className,
      )}
      style={{
        color,
        backgroundColor: `${color}1f`,
        border: `1px solid ${color}33`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {status}
    </span>
  );
}
