import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent hover:bg-accent-strong border border-transparent",
  ghost:
    "bg-transparent text-content hover:bg-hover border border-border hover:border-border-strong",
  danger:
    "bg-transparent text-danger hover:bg-danger/10 border border-danger/40",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-sm gap-1.5",
  md: "h-9 px-4 text-sm rounded-sm gap-2",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button while a mutation is pending. */
  loading?: boolean;
}

/** Reduced-motion-safe spinner (CSS only — no icon import / no SSR concern). */
function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      className,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center font-medium tracking-tight",
        "transition-[background-color,transform,border-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
