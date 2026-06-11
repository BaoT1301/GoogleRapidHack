"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

type ToolKind = "read" | "write" | "execute";

interface CliTool {
  name: string;
  kind: ToolKind;
  description: string;
}
interface CliToolCatalog {
  cli: string;
  wired: boolean;
  tools: CliTool[];
  defaultAllowed: string[];
  readOnly: string[];
  note?: string;
}

const KIND_TONE: Record<ToolKind, string> = {
  read: "#46b85f",
  write: "#d8a72b",
  execute: "#ef6b5c",
};

const CLI_LABEL: Record<string, string> = {
  kiro: "Kiro",
  codex: "Codex",
  gemini: "Gemini",
  claude: "Claude",
};

/**
 * Per-CLI allowed-tools editor (CLI-4, per-CLI rework). Renders one section per
 * coding CLI from `system.cliTools`, lets the user toggle which tools EXECUTE
 * nodes may use (writes opt-in), and persists the whole map via
 * `settings.update({ allowedToolsByCli })`.
 *
 * Only **kiro** is wired into execution today (its set maps to kiro
 * `--trust-tools`); non-wired CLIs render an informational note so the user
 * knows their selection is saved as intent but not yet enforced. The planner is
 * ALWAYS read-only. No key values are ever shown (tool names only).
 */
export function AllowedToolsEditor({ enabled = true }: { enabled?: boolean }) {
  const trpc = useTRPC();
  const catalogsQ = useQuery(
    trpc.system.cliTools.queryOptions(undefined, { enabled, refetchOnWindowFocus: false }),
  );
  const settingsQ = useQuery(trpc.settings.get.queryOptions(undefined, { enabled }));
  const update = useMutation(
    trpc.settings.update.mutationOptions({ onSuccess: () => settingsQ.refetch() }),
  );

  const catalogs = catalogsQ.data as CliToolCatalog[] | undefined;
  const persisted =
    (settingsQ.data as { allowedToolsByCli?: Record<string, string[]> } | undefined)
      ?.allowedToolsByCli ?? null;

  // Local selection state, keyed by CLI.
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  // Sync local selection when the persisted map first loads / changes.
  const persistedKey = persisted
    ? Object.entries(persisted)
        .map(([cli, tools]) => `${cli}:${[...tools].sort().join(",")}`)
        .sort()
        .join("|")
    : null;
  useEffect(() => {
    if (!persisted) return;
    const next: Record<string, Set<string>> = {};
    for (const [cli, tools] of Object.entries(persisted)) {
      next[cli] = new Set(tools);
    }
    setSelected(next);
  }, [persistedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = (catalogsQ.isFetching && !catalogs) || (settingsQ.isFetching && !persisted);

  const dirty = useMemo(() => {
    if (!persisted || !catalogs) return false;
    return catalogs.some((c) => {
      const sel = selected[c.cli] ?? new Set<string>();
      const base = persisted[c.cli] ?? [];
      return base.length !== sel.size || base.some((t) => !sel.has(t));
    });
  }, [selected, persisted, catalogs]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy aria-label="Loading allowed tools">
        {[0, 1].map((s) => (
          <div key={s} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex items-start gap-2">
                <Skeleton className="mt-0.5 h-3 w-3" />
                <Skeleton className="h-3 w-48" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (!catalogs) {
    return <p className="text-xs text-faint">Tool catalogs unavailable.</p>;
  }

  const toggle = (cli: string, name: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[cli] ?? []);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      next[cli] = set;
      return next;
    });
  };

  const save = () => {
    const payload: Record<string, string[]> = {};
    for (const c of catalogs) {
      payload[c.cli] = [...(selected[c.cli] ?? new Set<string>())];
    }
    update.mutate({ allowedToolsByCli: payload });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-faint">
        Tools EXECUTE nodes may use. Writes are opt-in and the planner is{" "}
        <span className="text-content">always read-only</span>. Only{" "}
        <span className="text-content">Kiro</span> is wired into execution today;
        other CLIs save your selection as intent.
      </p>

      {catalogs.map((c) => {
        const sel = selected[c.cli] ?? new Set<string>();
        return (
          <section key={c.cli} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold tracking-wide text-content">
                {CLI_LABEL[c.cli] ?? c.cli}
              </h4>
              {c.wired ? (
                <span
                  className="rounded-full px-1.5 text-[10px] uppercase tracking-wide"
                  style={{ color: "#46b85f", backgroundColor: "#46b85f1f" }}
                >
                  wired
                </span>
              ) : (
                <span
                  className="rounded-full px-1.5 text-[10px] uppercase tracking-wide"
                  style={{ color: "#8b93a7", backgroundColor: "#8b93a71f" }}
                >
                  informational
                </span>
              )}
            </div>

            {c.note ? <p className="text-[11px] text-faint">{c.note}</p> : null}

            <ul className="flex flex-col gap-1.5" aria-label={`${CLI_LABEL[c.cli] ?? c.cli} tools`}>
              {c.tools.map((t) => {
                const id = `tool-${c.cli}-${t.name}`;
                return (
                  <li key={t.name} className="flex items-start gap-2">
                    <input
                      id={id}
                      type="checkbox"
                      checked={sel.has(t.name)}
                      onChange={() => toggle(c.cli, t.name)}
                      className="mt-0.5 accent-accent"
                    />
                    <label htmlFor={id} className="flex flex-col">
                      <span className="flex items-center gap-1.5 text-xs text-content">
                        <code>{t.name}</code>
                        <span
                          className="rounded-full px-1.5 text-[10px] uppercase tracking-wide"
                          style={{ color: KIND_TONE[t.kind], backgroundColor: `${KIND_TONE[t.kind]}1f` }}
                        >
                          {t.kind}
                        </span>
                      </span>
                      <span className="text-[11px] text-faint">{t.description}</span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {sel.size === 0 ? (
              <span className="text-[11px] text-faint">
                Empty saves as the read-only default ({c.defaultAllowed.join(", ")}).
              </span>
            ) : null}
          </section>
        );
      })}

      <div>
        <Button size="sm" onClick={save} loading={update.isPending} disabled={!dirty}>
          Save tools
        </Button>
      </div>
    </div>
  );
}
