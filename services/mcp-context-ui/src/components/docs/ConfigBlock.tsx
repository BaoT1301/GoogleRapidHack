/**
 * ConfigBlock — JSON configuration display with file path header, copy button, and editor hint.
 */
import { CodeBlock } from "../ui/code-block";
import { FileCode2 } from "lucide-react";

interface ConfigBlockProps {
  filePath: string;
  config: string;
  title?: string;
  className?: string;
}

export function ConfigBlock({ filePath, config, title, className }: ConfigBlockProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
        <FileCode2 className="h-3.5 w-3.5" />
        <span className="font-medium">File:</span>
        <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono">
          {filePath}
        </code>
      </div>
      <CodeBlock
        code={config}
        language="json"
        title={title}
      />
    </div>
  );
}
