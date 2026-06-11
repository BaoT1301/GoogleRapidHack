"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon, TrashIcon, PencilSimpleIcon, CopyIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { listPacks, getPack, DEFAULT_PACK_ID, type ThemePack } from "@/lib/canvas-theme";
import { CustomPackBuilder } from "@/components/settings/CustomPackBuilder";

type BackgroundKind = "dots" | "lines" | "cross" | "none";

const BACKGROUNDS: { id: BackgroundKind; label: string }[] = [
  { id: "dots", label: "Dots" },
  { id: "lines", label: "Lines" },
  { id: "cross", label: "Cross" },
  { id: "none", label: "None" },
];

interface AppearanceSettingsData {
  canvasThemePackId?: string | null;
  canvasConfig?: { motionEnabled?: boolean; backgroundKind?: BackgroundKind };
}

/**
 * Canvas appearance controls (Theme Packs). Persists per-user via
 * `settings.update`; the CanvasThemeProvider reads the same `settings.get` query,
 * so changing a setting here re-skins an open canvas after the cache refetches.
 */
export function AppearanceSettings({ enabled = true }: { enabled?: boolean }) {
  const trpc = useTRPC();
  const settings = useQuery(trpc.settings.get.queryOptions(undefined, { enabled }));
  const userPacksQuery = useQuery(
    trpc.themePacks.list.queryOptions(undefined, { enabled }),
  );
  const update = useMutation(
    trpc.settings.update.mutationOptions({ onSuccess: () => settings.refetch() }),
  );
  const removePack = useMutation(
    trpc.themePacks.remove.mutationOptions({
      onSuccess: () => userPacksQuery.refetch(),
    }),
  );
  const [builderOpen, setBuilderOpen] = useState(false);
  // Builder context: editing an existing custom pack, and/or a base to fork from.
  const [editingPack, setEditingPack] = useState<ThemePack | null>(null);
  const [baseForNew, setBaseForNew] = useState<string | undefined>(undefined);

  const openCreate = () => {
    setEditingPack(null);
    setBaseForNew(undefined);
    setBuilderOpen(true);
  };
  const openCustomize = (basePackId: string) => {
    setEditingPack(null);
    setBaseForNew(basePackId);
    setBuilderOpen(true);
  };
  const openEdit = (pack: ThemePack) => {
    setEditingPack(pack);
    setBaseForNew(undefined);
    setBuilderOpen(true);
  };
  const closeBuilder = () => {
    setBuilderOpen(false);
    setEditingPack(null);
    setBaseForNew(undefined);
  };

  const data = settings.data as AppearanceSettingsData | undefined;
  const activePackId = data?.canvasThemePackId ?? DEFAULT_PACK_ID;
  const motionEnabled = data?.canvasConfig?.motionEnabled ?? true;
  const activeBackground = data?.canvasConfig?.backgroundKind;

  const userPacks = (userPacksQuery.data as ThemePack[] | undefined) ?? [];
  const builtInPacks = listPacks();
  // The active pack's own background — when it's an image, the per-user grid
  // override below does not apply (the pack's image wins, see applyCanvasConfig).
  const activePack =
    userPacks.find((p) => p.id === activePackId) ?? getPack(activePackId);
  const activeIsImageBackground = activePack.background.kind === "image";

  const selectPack = (id: string) => {
    if (id !== activePackId) update.mutate({ canvasThemePackId: id });
  };
  const toggleMotion = () =>
    update.mutate({ canvasConfig: { motionEnabled: !motionEnabled } });
  const selectBackground = (kind: BackgroundKind) => {
    if (kind !== activeBackground)
      update.mutate({ canvasConfig: { backgroundKind: kind } });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium tracking-wide text-muted">Theme pack</h3>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 text-[11px] font-medium text-content transition-colors hover:border-border-strong hover:bg-hover"
          >
            <PlusIcon size={12} /> Create custom pack
          </button>
        </div>
        <div
          role="radiogroup"
          aria-label="Canvas theme pack"
          className="grid grid-cols-2 gap-2"
        >
          {builtInPacks.map((p) => (
            <div
              key={p.id}
              className={[
                "group flex items-center gap-2 rounded-sm border p-3 transition-colors",
                p.id === activePackId
                  ? "border-accent/60 bg-accent/10"
                  : "border-border bg-surface hover:border-border-strong",
              ].join(" ")}
            >
              <button
                type="button"
                role="radio"
                aria-checked={p.id === activePackId}
                onClick={() => selectPack(p.id)}
                className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
              >
                <span className="text-xs font-medium text-content">{p.name}</span>
                {p.id === activePackId ? (
                  <span className="text-[10px] text-accent">· active</span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`Customize ${p.name}`}
                title="Customize (creates an editable copy)"
                onClick={() => openCustomize(p.id)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:bg-hover hover:text-content"
              >
                <CopyIcon size={13} />
              </button>
            </div>
          ))}
          {userPacks.map((p) => (
            <div
              key={p.id}
              className={[
                "group flex items-center gap-2 rounded-sm border p-3 transition-colors",
                p.id === activePackId
                  ? "border-accent/60 bg-accent/10"
                  : "border-border bg-surface hover:border-border-strong",
              ].join(" ")}
            >
              <button
                type="button"
                role="radio"
                aria-checked={p.id === activePackId}
                onClick={() => selectPack(p.id)}
                className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
              >
                <span className="flex items-center gap-1.5 truncate text-xs font-medium text-content">
                  {p.name}
                  <span className="rounded-sm border border-accent/40 bg-accent/10 px-1 text-[9px] uppercase tracking-wide text-accent">
                    custom
                  </span>
                </span>
                {p.id === activePackId ? (
                  <span className="text-[10px] text-accent">· active</span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`Edit ${p.name}`}
                title="Edit this pack"
                onClick={() => openEdit(p)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:bg-hover hover:text-content"
              >
                <PencilSimpleIcon size={13} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${p.name}`}
                onClick={() => removePack.mutate({ id: p.id })}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <TrashIcon size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted">Background</h3>
        <div
          role="radiogroup"
          aria-label="Canvas background"
          className={[
            "grid grid-cols-4 gap-2",
            activeIsImageBackground ? "opacity-50" : "",
          ].join(" ")}
        >
          {BACKGROUNDS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={b.id === activeBackground}
              disabled={activeIsImageBackground}
              onClick={() => selectBackground(b.id)}
              className={[
                "rounded-sm border px-2 py-1.5 text-xs font-medium transition-colors",
                b.id === activeBackground
                  ? "border-accent/60 bg-accent/10 text-content"
                  : "border-border bg-surface text-muted hover:border-border-strong",
                activeIsImageBackground ? "cursor-not-allowed" : "",
              ].join(" ")}
            >
              {b.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint">
          {activeIsImageBackground
            ? "The active pack uses a custom background image, which takes priority over these grid styles. Switch to a non-image pack to use a grid background."
            : "Overrides the selected pack's background. Pick one to customize the canvas grid."}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted">Motion</h3>
        <button
          type="button"
          role="switch"
          aria-checked={motionEnabled}
          aria-label="Canvas motion"
          onClick={toggleMotion}
          className={[
            "inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            motionEnabled
              ? "border-accent/60 bg-accent/10 text-content"
              : "border-border bg-surface text-muted hover:border-border-strong",
          ].join(" ")}
        >
          <span
            className={[
              "h-1.5 w-1.5 rounded-full",
              motionEnabled ? "bg-accent" : "bg-faint",
            ].join(" ")}
          />
          {motionEnabled ? "Motion on" : "Motion off"}
        </button>
        <p className="text-[11px] text-faint">
          Status animations (e.g. the running pulse) always honor your system
          &ldquo;reduce motion&rdquo; preference.
        </p>
      </section>

      <CustomPackBuilder
        open={builderOpen}
        onClose={closeBuilder}
        userPacks={userPacks}
        editPack={editingPack}
        initialBasePackId={baseForNew}
        onCreated={(pack) => {
          userPacksQuery.refetch();
          update.mutate({ canvasThemePackId: pack.id });
        }}
        onUpdated={() => {
          // Refetch so CanvasThemeProvider (fed by themePacks.list) re-skins live.
          userPacksQuery.refetch();
        }}
      />
    </div>
  );
}
