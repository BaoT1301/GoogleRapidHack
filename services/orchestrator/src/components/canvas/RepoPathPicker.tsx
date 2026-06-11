"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FolderIcon,
  FolderOpenIcon,
  ArrowUpIcon,
  GitBranchIcon,
  HouseIcon,
} from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";

/**
 * Smart repo-path picker: a text input prefilled with the server-detected default
 * repo root (git top-level of the server cwd — `repo.defaultRoot`) plus a "Browse"
 * button that opens a read-only server-side directory browser (`repo.listDir`).
 * Controlled (`value`/`onChange`) so it drops into existing forms in place of a
 * plain `<Input>`. Git repos are flagged in the browser so the user can spot the
 * right folder at a glance.
 */
export function RepoPathPicker({
  value,
  onChange,
  id,
  placeholder = "/abs/path/to/repo",
  autofillDefault = true,
}: {
  value: string;
  onChange: (path: string) => void;
  id?: string;
  placeholder?: string;
  /** Prefill the detected default root once when `value` starts empty. */
  autofillDefault?: boolean;
}) {
  const trpc = useTRPC();
  const [browseOpen, setBrowseOpen] = useState(false);

  const defaultRoot = useQuery(
    trpc.repo.defaultRoot.queryOptions(undefined, { refetchOnWindowFocus: false }),
  );

  // Autofill the detected default exactly once when the field starts empty.
  const autofilled = useRef(false);
  useEffect(() => {
    if (
      autofillDefault &&
      !autofilled.current &&
      !value.trim() &&
      defaultRoot.data?.path
    ) {
      autofilled.current = true;
      onChange(defaultRoot.data.path);
    }
  }, [autofillDefault, value, defaultRoot.data?.path, onChange]);

  return (
    <>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          onClick={() => setBrowseOpen(true)}
          aria-label="Browse for repository folder"
        >
          <FolderOpenIcon size={14} className="mr-1.5" />
          Browse
        </Button>
      </div>
      <BrowseDialog
        open={browseOpen}
        initialPath={value || defaultRoot.data?.path || ""}
        defaultPath={defaultRoot.data?.path}
        onClose={() => setBrowseOpen(false)}
        onSelect={(p) => {
          onChange(p);
          setBrowseOpen(false);
        }}
      />
    </>
  );
}

function BrowseDialog({
  open,
  initialPath,
  defaultPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  initialPath: string;
  defaultPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const trpc = useTRPC();
  const [browsePath, setBrowsePath] = useState(initialPath);

  // Re-seed the browse location each time the dialog opens.
  useEffect(() => {
    if (open) setBrowsePath(initialPath);
  }, [open, initialPath]);

  const listing = useQuery(
    trpc.repo.listDir.queryOptions(
      { path: browsePath || undefined },
      { enabled: open, refetchOnWindowFocus: false },
    ),
  );

  // The server resolves/normalizes the path (and may fall back) — track what it
  // actually listed so "Use this folder" and "Up" operate on the real path.
  const resolvedPath = listing.data?.path ?? browsePath;
  const parent = listing.data?.parent ?? null;
  const entries = listing.data?.entries ?? [];

  return (
    <Dialog open={open} onClose={onClose} title="Select repository folder">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => parent && setBrowsePath(parent)}
            disabled={!parent}
            aria-label="Go to parent directory"
            className="rounded-sm border border-border p-1.5 text-muted transition-colors hover:text-content disabled:opacity-40"
          >
            <ArrowUpIcon size={14} />
          </button>
          {defaultPath && (
            <button
              type="button"
              onClick={() => setBrowsePath(defaultPath)}
              aria-label="Go to default repository root"
              className="rounded-sm border border-border p-1.5 text-muted transition-colors hover:text-content"
            >
              <HouseIcon size={14} />
            </button>
          )}
          <code className="min-w-0 flex-1 truncate rounded-sm bg-surface px-2 py-1.5 text-xs text-content" title={resolvedPath}>
            {resolvedPath || "—"}
          </code>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-sm border border-border">
          {listing.isLoading ? (
            <p className="px-3 py-4 text-center text-xs text-faint">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-faint">
              No sub-folders here.
            </p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    onClick={() =>
                      setBrowsePath(
                        joinPath(resolvedPath, entry.name),
                      )
                    }
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface"
                  >
                    <FolderIcon
                      size={14}
                      weight={entry.isGitRepo ? "fill" : "regular"}
                      className={cn(
                        "shrink-0",
                        entry.isGitRepo ? "text-accent" : "text-faint",
                        entry.isHidden && "opacity-50",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-content",
                        entry.isHidden && "text-muted",
                      )}
                    >
                      {entry.name}
                    </span>
                    {entry.isGitRepo && (
                      <GitBranchIcon size={12} className="shrink-0 text-accent" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {listing.data?.truncated && (
            <p className="border-t border-border px-3 py-1.5 text-center text-[11px] text-faint">
              Showing the first {entries.length} folders.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-faint">
            {listing.data?.isGitRepo ? (
              <span className="flex items-center gap-1 text-accent">
                <GitBranchIcon size={12} /> git repository
              </span>
            ) : (
              "not a git repository"
            )}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => onSelect(resolvedPath)}
              disabled={!resolvedPath}
            >
              Use this folder
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** Join a parent dir and child name with the parent's separator (POSIX/Windows). */
function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[/\\]+$/, "")}${sep}${name}`;
}
