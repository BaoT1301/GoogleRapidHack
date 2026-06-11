"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";

interface SkillItem {
  id: string;
  name: string;
  description?: string;
  source?: string;
}

/**
 * SKILL-2 — node skill-attach control. Lists the installed skills
 * (`skills.list`, parsed from `skills-lock.json`) as a multiselect and reflects
 * the node's current `data.skills`. Toggling calls `onChange` with the new id
 * array (the Inspector persists it additively via `graphs.update`). Accessible
 * (checkbox + label) and reduced-motion-safe (no animations). Never shows secrets.
 */
export function SkillAttach({
  value,
  onChange,
  enabled = true,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  enabled?: boolean;
}) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.skills.list.queryOptions(undefined, { enabled, refetchOnWindowFocus: false }),
  );
  const skills = (q.data as SkillItem[] | undefined) ?? [];
  const selected = new Set(value);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  if (q.isFetching && skills.length === 0) {
    return <p className="text-xs text-muted">Loading skills…</p>;
  }
  if (skills.length === 0) {
    return <p className="text-xs text-faint">No installed skills found.</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5" aria-label="Attach skills">
      {skills.map((s) => {
        const id = `skill-${s.id}`;
        return (
          <li key={s.id} className="flex items-start gap-2">
            <input
              id={id}
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggle(s.id)}
              className="mt-0.5 accent-accent"
            />
            <label htmlFor={id} className="flex flex-col">
              <span className="text-xs text-content">{s.name}</span>
              <span className="text-[10px] text-faint">
                <code>{s.id}</code>
                {s.source ? ` · ${s.source}` : ""}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
