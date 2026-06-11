"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

interface SkillItem {
  id: string;
  name: string;
  description?: string;
  source?: string;
}

/**
 * SKILL-2 + SKILL-INSTALL — installed-skills registry with an "Add skill from
 * source" form and per-row re-pin / remove controls. The list is read from the
 * repo-root `skills-lock.json` (`skills.list`); mutations (`skills.add/repin/
 * remove`) install/update/delete a skill and then invalidate the list. The
 * GitHub token (private repos) is referenced by a vault secret id — a raw token
 * is never sent here and never displayed.
 */
export function SkillRegistry({ enabled = true }: { enabled?: boolean }) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.skills.list.queryOptions(undefined, { enabled, refetchOnWindowFocus: false }),
  );
  const skills = (q.data as SkillItem[] | undefined) ?? [];

  const [source, setSource] = useState("");
  const [id, setId] = useState("");
  const [tokenSecretId, setTokenSecretId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => q.refetch();

  const add = useMutation(
    trpc.skills.add.mutationOptions({
      onSuccess: () => {
        setSource("");
        setId("");
        setTokenSecretId("");
        setError(null);
        refresh();
      },
      onError: (e: { message?: string }) => setError(e?.message ?? "Install failed."),
    }),
  );
  const repin = useMutation(trpc.skills.repin.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.skills.remove.mutationOptions({ onSuccess: refresh }));

  const busy = add.isPending || repin.isPending || remove.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const src = source.trim();
    if (!src) return;
    setError(null);
    add.mutate({
      source: src,
      id: id.trim() || undefined,
      tokenSecretId: tokenSecretId.trim() || undefined,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Add skill from source">
        <label className="flex flex-col gap-1 text-[11px] text-faint">
          Source
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="owner/repo:skills/foo@main"
            aria-label="Skill source"
            className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-content placeholder:text-faint focus:border-accent/60 focus:outline-none"
          />
        </label>
        <div className="flex gap-2">
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="id (optional)"
            aria-label="Skill id (optional)"
            className="w-1/2 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-content placeholder:text-faint focus:border-accent/60 focus:outline-none"
          />
          <input
            value={tokenSecretId}
            onChange={(e) => setTokenSecretId(e.target.value)}
            placeholder="token secret id (private repos)"
            aria-label="Token secret id (optional)"
            className="w-1/2 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-content placeholder:text-faint focus:border-accent/60 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between">
          <Button type="submit" size="sm" loading={add.isPending} disabled={!source.trim() || busy}>
            Add skill
          </Button>
          <span className="text-[10px] text-faint">Installs to the shared skills lockfile.</span>
        </div>
      </form>

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      {q.isFetching && skills.length === 0 ? (
        <ul className="flex flex-col gap-1.5" aria-busy aria-label="Loading skills">
          {[0, 1].map((i) => (
            <li
              key={i}
              className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface px-3 py-2"
            >
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2.5 w-48" />
            </li>
          ))}
        </ul>
      ) : skills.length === 0 ? (
        <p className="text-xs text-faint">No installed skills yet — add one above.</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Installed skills">
          {skills.map((s) => (
            <li
              key={s.id}
              className="flex items-start justify-between gap-2 rounded-sm border border-border bg-surface px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-xs text-content">{s.name}</span>
                <span className="text-[10px] text-faint">
                  <code>{s.id}</code>
                  {s.source ? ` · ${s.source}` : ""}
                </span>
                {s.description ? (
                  <span className="mt-0.5 text-[11px] text-muted">{s.description}</span>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  loading={repin.isPending && repin.variables?.id === s.id}
                  disabled={busy}
                  onClick={() => repin.mutate({ id: s.id })}
                >
                  Re-pin
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  loading={remove.isPending && remove.variables?.id === s.id}
                  disabled={busy}
                  onClick={() => remove.mutate({ id: s.id })}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
