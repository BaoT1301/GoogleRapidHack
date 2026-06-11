"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranchIcon, PlusIcon, CheckIcon, CaretDownIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { Input } from "@/components/ui/Field";
import { cn } from "@/lib/cn";

/**
 * Base-branch combobox: pick an existing LOCAL branch (from `repo.listBranches`
 * for the resolved repo path) OR type a NEW name. A novel name is offered as a
 * "Create new branch" affordance and, once chosen, is materialized from the
 * current HEAD at run start by `ensureBaseBranch` — the form itself performs no
 * git write. Controlled (`value`/`onChange`). Degrades to a plain free-text input
 * when the path isn't a git repo (or no path yet), so it never blocks the form.
 */
export function BaseBranchPicker({
  value,
  onChange,
  repoPath,
  id,
  placeholder = "main",
}: {
  value: string;
  onChange: (branch: string) => void;
  repoPath?: string;
  id?: string;
  placeholder?: string;
}) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const branchesQ = useQuery(
    trpc.repo.listBranches.queryOptions(
      { path: repoPath?.trim() || undefined },
      { enabled: !!repoPath?.trim(), refetchOnWindowFocus: false },
    ),
  );

  const isGitRepo = branchesQ.data?.isGitRepo ?? false;
  const branches = useMemo(() => branchesQ.data?.branches ?? [], [branchesQ.data]);
  const currentBranch = branchesQ.data?.currentBranch;

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const trimmed = value.trim();
  const isExisting = branches.includes(trimmed);
  // Filter as the user types a NEW/partial name, but show the full list when the
  // value is empty or exactly matches an existing branch (so focusing a prefilled
  // field still reveals every branch to switch to).
  const filtered = useMemo(
    () =>
      trimmed && !isExisting
        ? branches.filter((b) => b.toLowerCase().includes(trimmed.toLowerCase()))
        : branches,
    [branches, trimmed, isExisting],
  );
  const isNew = isGitRepo && trimmed.length > 0 && !isExisting;

  // Not a git repo (or no path resolved yet) → plain free-text input.
  if (!isGitRepo) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div ref={wrapRef} className="relative flex flex-col gap-1">
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="pr-8"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle branch list"
          className="absolute inset-y-0 right-0 flex items-center px-2 text-faint hover:text-content"
        >
          <CaretDownIcon size={14} />
        </button>
      </div>

      {open && (
        <ul
          role="listbox"
          className="absolute top-full z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-sm border border-border bg-panel shadow-lg"
        >
          {isNew && (
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange(trimmed);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-accent transition-colors hover:bg-surface"
              >
                <PlusIcon size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  Create new branch: <span className="font-medium">{trimmed}</span>
                </span>
              </button>
            </li>
          )}
          {filtered.length === 0 && !isNew ? (
            <li className="px-3 py-2 text-xs text-faint">No matching branches.</li>
          ) : (
            filtered.map((branch) => (
              <li key={branch}>
                <button
                  type="button"
                  role="option"
                  aria-selected={branch === trimmed}
                  onClick={() => {
                    onChange(branch);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-content transition-colors hover:bg-surface"
                >
                  <GitBranchIcon size={14} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{branch}</span>
                  {branch === currentBranch && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                      current
                    </span>
                  )}
                  {branch === trimmed && (
                    <CheckIcon size={13} className="shrink-0 text-accent" />
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {isNew && (
        <span className="text-[11px] text-accent">
          New branch — created from current HEAD when the run starts.
        </span>
      )}
    </div>
  );
}
