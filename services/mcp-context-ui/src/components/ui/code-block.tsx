/**
 * CodeBlock component for displaying syntax-highlighted code with copy functionality.
 */
import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  className?: string;
  showLineNumbers?: boolean;
}

function CodeBlock({ code, language, title, className, showLineNumbers = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const lines = code.split("\n");

  return (
    <div className={cn("rounded-lg border border-slate-200 overflow-hidden", className)}>
      {/* Header */}
      {(title || language) && (
        <div className="flex items-center justify-between bg-slate-50 px-4 py-2 border-b border-slate-200">
          <div className="flex items-center gap-2">
            {title && <span className="text-xs font-medium text-slate-600">{title}</span>}
            {language && (
              <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                {language}
              </span>
            )}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-success-500" />
                <span className="text-success-500">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Code content */}
      <div className="overflow-x-auto bg-slate-900 p-4">
        <pre className="text-sm leading-relaxed">
          <code className="text-slate-100 font-mono">
            {showLineNumbers
              ? lines.map((line, i) => (
                  <div key={i} className="flex">
                    <span className="select-none text-slate-500 w-8 text-right mr-4 shrink-0">
                      {i + 1}
                    </span>
                    <span>{line}</span>
                  </div>
                ))
              : code}
          </code>
        </pre>
      </div>
    </div>
  );
}

export { CodeBlock };
export type { CodeBlockProps };
