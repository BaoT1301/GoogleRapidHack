"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { RepoPathPicker } from "@/components/canvas/RepoPathPicker";
import { BaseBranchPicker } from "@/components/canvas/BaseBranchPicker";

/**
 * Create-graph dialog. Persona picker (templates.list) supplies a create-time
 * default persona, carried to the canvas via `?persona=` for new Execute nodes.
 */
export function CreateGraphDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [rootRepoPath, setRootRepoPath] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [persona, setPersona] = useState("");

  const personas = useQuery(
    trpc.templates.list.queryOptions({ kind: "persona" }),
  );

  const create = useMutation(
    trpc.graphs.create.mutationOptions({
      onSuccess: (graph: { _id: unknown }) => {
        qc.invalidateQueries({ queryKey: trpc.graphs.list.queryKey() });
        const q = persona ? `?persona=${encodeURIComponent(persona)}` : "";
        router.push(`/dashboard/${String(graph._id)}${q}`);
      },
      onError: (e: { message: string }) =>
        toast(e.message || "Failed to create graph", "error"),
    }),
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({
      name: name.trim(),
      rootRepoPath: rootRepoPath.trim() || undefined,
      baseBranch: baseBranch.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="New graph">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name" htmlFor="g-name">
          <Input
            id="g-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Auth refactor sprint"
          />
        </Field>
        <Field
          label="Default persona"
          hint="Seeds the persona for new Execute nodes on the canvas."
        >
          <Select
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          >
            <option value="">None</option>
            {personas.data?.map((t: { id: string; name: string }) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Repo path" hint="Defaults to the current repository — Browse to change it.">
          <RepoPathPicker value={rootRepoPath} onChange={setRootRepoPath} />
        </Field>
        <Field label="Base branch" hint="Pick an existing branch or type a new name to create.">
          <BaseBranchPicker
            value={baseBranch}
            onChange={setBaseBranch}
            repoPath={rootRepoPath}
          />
        </Field>
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            Create graph
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
