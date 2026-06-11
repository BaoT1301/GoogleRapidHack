/**
 * CodeBlock for documentation pages — wraps the UI CodeBlock with
 * additional features like download button and file path header.
 */
import { useCallback } from "react";
import { Download } from "lucide-react";
import { CodeBlock as BaseCodeBlock } from "../ui/code-block";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

interface DocsCodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  fileName?: string;
  showDownload?: boolean;
  showLineNumbers?: boolean;
  className?: string;
}

export function DocsCodeBlock({
  code,
  language,
  title,
  fileName,
  showDownload = false,
  showLineNumbers = false,
  className,
}: DocsCodeBlockProps) {
  const handleDownload = useCallback(() => {
    if (!fileName) return;
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [code, fileName]);

  return (
    <div className={cn("space-y-2", className)}>
      {showDownload && fileName && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
            Download {fileName}
          </Button>
        </div>
      )}
      <BaseCodeBlock
        code={code}
        language={language}
        title={title}
        showLineNumbers={showLineNumbers}
      />
    </div>
  );
}
