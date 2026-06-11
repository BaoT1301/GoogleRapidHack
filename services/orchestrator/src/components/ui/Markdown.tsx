import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal, dependency-free Markdown renderer for persona/rule content.
 *
 * Supported subset: ATX headings (`#`..`######`), unordered (`-`/`*`) and
 * ordered (`1.`) lists, fenced code blocks (```), inline code (`` ` ``),
 * **bold**, *italic*, [links](url), and paragraphs.
 *
 * SAFETY: output is built from React elements only — we NEVER use
 * `dangerouslySetInnerHTML`, so any raw HTML in the source is rendered as
 * literal, escaped text (React escapes text nodes). Link hrefs are sanitized to
 * block `javascript:`/`data:` and other script-bearing schemes; an unsafe link
 * degrades to plain text.
 */
export function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 text-sm leading-relaxed text-content",
        className,
      )}
      data-testid="markdown"
    >
      {renderBlocks(source)}
    </div>
  );
}

/** Allow http(s), mailto, anchors, and relative paths; block script schemes. */
export function sanitizeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(trimmed)) return trimmed;
  // Any other explicit URI scheme (javascript:, data:, vbscript:, …) is unsafe.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  // No scheme → treat as a relative reference.
  return trimmed;
}

const INLINE_PATTERNS: { type: string; re: RegExp }[] = [
  { type: "code", re: /`([^`]+)`/ },
  { type: "link", re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { type: "bold", re: /\*\*([^*]+)\*\*/ },
  { type: "italic", re: /\*([^*]+)\*/ },
];

/** Parse inline markdown into React nodes (recursive for nested emphasis). */
export function parseInline(text: string, keyBase = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let k = 0;

  while (remaining.length > 0) {
    let best: { type: string; m: RegExpExecArray } | null = null;
    for (const p of INLINE_PATTERNS) {
      const m = p.re.exec(remaining);
      if (m && (best === null || m.index < best.m.index)) {
        best = { type: p.type, m };
      }
    }

    if (!best) {
      nodes.push(remaining);
      break;
    }

    const { type, m } = best;
    if (m.index > 0) nodes.push(remaining.slice(0, m.index));
    const key = `${keyBase}-${k++}`;

    if (type === "code") {
      nodes.push(
        <code key={key} className="rounded-sm bg-elevated px-1 py-0.5 font-mono text-[0.85em]">
          {m[1]}
        </code>,
      );
    } else if (type === "link") {
      const href = sanitizeHref(m[2]);
      if (href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2 hover:text-accent-strong"
          >
            {parseInline(m[1], key)}
          </a>,
        );
      } else {
        // Unsafe scheme → render the visible text only, no link.
        nodes.push(<Fragment key={key}>{parseInline(m[1], key)}</Fragment>);
      }
    } else if (type === "bold") {
      nodes.push(
        <strong key={key} className="font-semibold text-content">
          {parseInline(m[1], key)}
        </strong>,
      );
    } else if (type === "italic") {
      nodes.push(<em key={key}>{parseInline(m[1], key)}</em>);
    }

    remaining = remaining.slice(m.index + m[0].length);
  }

  return nodes;
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-base font-semibold tracking-tight text-content",
  2: "text-sm font-semibold tracking-tight text-content",
  3: "text-sm font-medium text-content",
  4: "text-xs font-semibold uppercase tracking-wide text-muted",
  5: "text-xs font-medium text-muted",
  6: "text-xs font-medium text-faint",
};

/** Parse block-level markdown into React nodes. */
function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const nextKey = () => `b-${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = /^```(.*)$/.exec(line.trim());
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (if present)
      blocks.push(
        <pre
          key={nextKey()}
          className="overflow-x-auto rounded-sm border border-border bg-surface p-3 text-xs"
        >
          <code className="font-mono text-content">{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      blocks.push(
        <Tag key={nextKey()} className={HEADING_CLASS[level]}>
          {parseInline(heading[2], `h${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={nextKey()} className="flex list-disc flex-col gap-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{parseInline(it, `ul${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={nextKey()} className="flex list-decimal flex-col gap-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{parseInline(it, `ol${key}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blank line → skip.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: accumulate consecutive non-blank, non-special lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={nextKey()} className="text-content">
        {parseInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return blocks;
}
