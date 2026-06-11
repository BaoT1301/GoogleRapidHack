"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon, CopyIcon, PencilSimpleIcon, TrashIcon, EyeIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Markdown } from "@/components/ui/Markdown";
import { Skeleton } from "@/components/ui/Skeleton";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import type { TemplateItem } from "@/trpc/types";

type KindFilter = "all" | "persona" | "rule";
const KIND_OPTIONS: { value: "persona" | "rule"; label: string }[] = [
  { value: "persona", label: "Persona" },
  { value: "rule", label: "Rule" },
];

/**
 * Persona & rule management surface (TPL-1/2 UI). Lists default templates +
 * the user's workspace forks with a kind filter and Default/Workspace badges,
 * and exposes Create-blank, Duplicate, Edit (workspace only), and Delete
 * (workspace only, confirm-gated) — all via the `templates.*` tRPC procedures.
 *
 * Defaults are read-only (Duplicate to edit). No secret values exist on a
 * template, and none are ever rendered. Accessible + reduced-motion-safe
 * (the Dialog/Button primitives carry the motion-reduce handling).
 */
export function TemplateManager({ enabled = true }: { enabled?: boolean }) {
  const trpc = useTRPC();
  const [kind, setKind] = useState<KindFilter>("all");

  const listQ = useQuery(
    trpc.templates.list.queryOptions(
      kind === "all" ? undefined : { kind },
      { enabled, refetchOnWindowFocus: false },
    ),
  );

  const refetch = () => listQ.refetch();
  const createM = useMutation(trpc.templates.create.mutationOptions({ onSuccess: refetch }));
  const duplicateM = useMutation(trpc.templates.duplicate.mutationOptions({ onSuccess: refetch }));
  const deleteM = useMutation(trpc.templates.delete.mutationOptions({ onSuccess: refetch }));
  const updateM = useMutation(trpc.templates.update.mutationOptions({ onSuccess: refetch }));

  const items = (listQ.data as TemplateItem[] | undefined) ?? [];

  // Dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<TemplateItem | null>(null);
  const [editing, setEditing] = useState<TemplateItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TemplateItem | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          Filter
          <Select
            aria-label="Filter templates by kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
            className="h-8 w-32 py-1 text-xs"
          >
            <option value="all">All</option>
            <option value="persona">Personas</option>
            <option value="rule">Rules</option>
          </Select>
        </label>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon size={13} /> Create blank
        </Button>
      </div>

      {listQ.isFetching && items.length === 0 ? (
        <ul className="flex flex-col gap-1.5" aria-busy aria-label="Loading templates">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 rounded-sm border border-border bg-surface px-3 py-2"
            >
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-2.5 w-24" />
              </div>
              <Skeleton className="h-7 w-20" rounded="sm" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="text-xs text-faint">No templates yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Templates">
          {items.map((t) => (
            <li
              key={`${t.kind}:${t.id}:${t.source}`}
              className="flex items-center justify-between gap-2 rounded-sm border border-border bg-surface px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 text-xs text-content">
                  <span className="truncate font-medium">{t.name}</span>
                  <code className="text-[10px] text-faint">{t.id}</code>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-faint">
                  <span>{t.kind}</span>
                  <SourceBadge source={t.source} />
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {t.source === "workspace" ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${t.name}`}
                      onClick={() => setEditing(t)}
                    >
                      <PencilSimpleIcon size={13} /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => setConfirmDelete(t)}
                    >
                      <TrashIcon size={13} />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`View ${t.name}`}
                    onClick={() => setViewing(t)}
                  >
                    <EyeIcon size={13} /> View
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Duplicate ${t.name}`}
                  loading={duplicateM.isPending && duplicateM.variables?.id === t.id}
                  onClick={() =>
                    duplicateM.mutate({
                      id: t.id,
                      kind: t.kind,
                      newName: `${t.name} (copy)`,
                    })
                  }
                >
                  <CopyIcon size={13} /> Duplicate
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateDialog
        open={createOpen}
        pending={createM.isPending}
        onClose={() => setCreateOpen(false)}
        onCreate={(input) =>
          createM.mutate(input, { onSuccess: () => setCreateOpen(false) })
        }
      />

      <ViewDialog template={viewing} onClose={() => setViewing(null)} />

      <EditDialog
        template={editing}
        pending={updateM.isPending}
        onClose={() => setEditing(null)}
        onSave={(content) =>
          editing &&
          updateM.mutate(
            { id: editing.id, content },
            { onSuccess: () => setEditing(null) },
          )
        }
      />

      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete template?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted">
            This permanently deletes your workspace{" "}
            <span className="text-content">{confirmDelete?.kind}</span> fork{" "}
            <code className="text-content">{confirmDelete?.id}</code>. Default
            templates are never affected.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={deleteM.isPending}
              onClick={() =>
                confirmDelete &&
                deleteM.mutate(
                  { id: confirmDelete.id, kind: confirmDelete.kind },
                  { onSuccess: () => setConfirmDelete(null) },
                )
              }
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function SourceBadge({ source }: { source: TemplateItem["source"] }) {
  const isDefault = source === "default";
  return (
    <span
      className="rounded-full px-1.5 text-[10px] normal-case"
      style={{
        color: isDefault ? "#8b93a7" : "#d8a72b",
        backgroundColor: isDefault ? "#8b93a71f" : "#d8a72b1f",
      }}
    >
      {isDefault ? "Default" : "Workspace fork"}
    </span>
  );
}

function CreateDialog({
  open,
  pending,
  onClose,
  onCreate,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onCreate: (input: { kind: "persona" | "rule"; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"persona" | "rule">("persona");

  useEffect(() => {
    if (open) {
      setName("");
      setKind("persona");
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title="Create blank template">
      <div className="flex flex-col gap-4">
        <Field label="Kind" htmlFor="tpl-create-kind">
          <Select
            id="tpl-create-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "persona" | "rule")}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" htmlFor="tpl-create-name" hint="The id is derived from the name.">
          <Input
            id="tpl-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My custom persona"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            loading={pending}
            disabled={name.trim().length === 0}
            onClick={() => onCreate({ kind, name: name.trim() })}
          >
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ViewDialog({
  template,
  onClose,
}: {
  template: TemplateItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={template !== null}
      onClose={onClose}
      title={template ? `View ${template.name}` : "View template"}
      widthClassName="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <p className="text-[11px] text-faint">
          Default templates are read-only. Use{" "}
          <span className="text-content">Duplicate</span> to create an editable
          workspace fork.
        </p>
        <div className="max-h-[60dvh] overflow-y-auto rounded-sm border border-border bg-surface p-4">
          <Markdown source={template?.content ?? ""} />
        </div>
      </div>
    </Dialog>
  );
}

function EditDialog({
  template,
  pending,
  onClose,
  onSave,
}: {
  template: TemplateItem | null;
  pending: boolean;
  onClose: () => void;
  onSave: (content: string) => void;
}) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    setContent(template?.content ?? "");
    setMode("edit"); // always reopen in edit mode
  }, [template?.id, template?.content]);

  return (
    <Dialog
      open={template !== null}
      onClose={onClose}
      title={`Edit ${template?.name ?? ""}`}
      widthClassName="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1" role="tablist" aria-label="Editor mode">
          {(["edit", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={
                "rounded-sm px-2.5 py-1 text-xs capitalize transition-colors " +
                (mode === m
                  ? "bg-active text-content"
                  : "text-faint hover:text-muted")
              }
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "edit" ? (
          <Field label="Content (Markdown)" htmlFor="tpl-edit-content">
            <Textarea
              id="tpl-edit-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={16}
              className="font-mono text-xs"
            />
          </Field>
        ) : (
          <div
            className="max-h-[60dvh] min-h-[10rem] overflow-y-auto rounded-sm border border-border bg-surface p-4"
            aria-label="Markdown preview"
          >
            {content.trim() ? (
              <Markdown source={content} />
            ) : (
              <p className="text-xs text-faint">Nothing to preview yet.</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={pending} onClick={() => onSave(content)}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
