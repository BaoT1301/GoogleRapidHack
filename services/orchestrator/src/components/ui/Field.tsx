import { cn } from "@/lib/cn";

const baseControl =
  "w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-content " +
  "placeholder:text-faint transition-colors duration-200 " +
  "focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30 " +
  "disabled:opacity-50";

/** Label-above-input wrapper (minimalist-ui: no placeholder-as-label). */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-muted">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(baseControl, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(baseControl, "resize-y leading-relaxed", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(baseControl, "appearance-none", className)} {...props}>
      {children}
    </select>
  );
}
