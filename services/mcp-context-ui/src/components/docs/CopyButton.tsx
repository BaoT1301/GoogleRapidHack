/**
 * CopyButton — Click-to-copy with toast feedback.
 * Copies the provided text to clipboard and shows a brief "Copied!" state.
 */
import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/utils";

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
}

export function CopyButton({ text, className, label = "Copy" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium transition-colors rounded-md px-2.5 py-1.5",
        copied
          ? "text-success-600 bg-success-50"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100",
        className
      )}
      aria-label={copied ? "Copied to clipboard" : label}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
