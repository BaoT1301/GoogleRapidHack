"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { NODE_KINDS } from "@/lib/graph-constants";
import type { NodeKind } from "@/db/models/graph.model";
import { getPack, type ThemePack } from "@/lib/canvas-theme";
import {
  VISUAL_STATUSES,
  type VisualStatus,
  type BackgroundFilterConfig,
} from "@/lib/canvas-theme/schema";
import {
  buildCustomPack,
  CORE_STATUSES,
  STATUS_ALIAS_GROUPS,
  type CustomPackDraft,
  type CustomStatusOverride,
} from "@/lib/canvas-theme/custom";

type Bg = "dots" | "lines" | "cross" | "none" | "image";

/** Neutral (no-op) background filter values used to seed the sliders. */
interface FilterState {
  blur: number;
  brightness: number;
  contrast: number;
  saturate: number;
  grayscale: number;
  opacity: number;
  tintColor: string;
  tintOpacity: number;
}

const DEFAULT_FILTER: FilterState = {
  blur: 0,
  brightness: 1,
  contrast: 1,
  saturate: 1,
  grayscale: 0,
  opacity: 1,
  tintColor: "#000000",
  tintOpacity: 0,
};

interface AssetMeta {
  id: string;
  name: string;
  url: string;
  pixelated?: boolean;
}

/**
 * Assemble a user custom theme pack from a base pack + per-kind colors/sprites +
 * background. Dual-mode:
 *  - CREATE — seeds from a chosen base pack; persists via `themePacks.create`.
 *  - EDIT   — when `editPack` is given, seeds from that pack and persists via
 *             `themePacks.update` (in place; id preserved).
 * The candidate pack is built (and validated) client-side with `buildCustomPack`;
 * the server re-validates and owns the id.
 */
export function CustomPackBuilder({
  open,
  onClose,
  userPacks,
  onCreated,
  onUpdated,
  editPack,
  initialBasePackId,
}: {
  open: boolean;
  onClose: () => void;
  userPacks: ThemePack[];
  onCreated: (pack: ThemePack) => void;
  /** Called after a successful in-place edit (`themePacks.update`). */
  onUpdated?: (pack: ThemePack) => void;
  /** When set, the builder edits this pack in place instead of creating. */
  editPack?: ThemePack | null;
  /** Create mode only: pre-select this base pack when the dialog opens. */
  initialBasePackId?: string;
}) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const isEdit = !!editPack;

  const assetsQuery = useQuery(
    trpc.assets.list.queryOptions(undefined, { enabled: open }),
  );
  const assets = (assetsQuery.data as AssetMeta[] | undefined) ?? [];

  const create = useMutation(
    trpc.themePacks.create.mutationOptions({
      onSuccess: (pack: ThemePack) => {
        toast("Custom pack created", "success");
        onCreated(pack);
        onClose();
      },
      onError: (e: unknown) =>
        toast(e instanceof Error ? e.message : "Could not create pack", "error"),
    }),
  );

  const updatePack = useMutation(
    trpc.themePacks.update.mutationOptions({
      onSuccess: (pack: ThemePack) => {
        toast("Custom pack updated", "success");
        onUpdated?.(pack);
        onClose();
      },
      onError: (e: unknown) =>
        toast(e instanceof Error ? e.message : "Could not update pack", "error"),
    }),
  );

  // Base pack options: built-ins + existing user packs.
  const baseOptions = useMemo(
    () => [
      { id: "classic", name: "Classic" },
      { id: "aurora", name: "Aurora" },
      { id: "pixel", name: "Pixel" },
      ...userPacks.map((p) => ({ id: p.id, name: `${p.name} (yours)` })),
    ],
    [userPacks],
  );
  const resolveBase = (id: string): ThemePack =>
    userPacks.find((p) => p.id === id) ?? getPack(id);

  const [name, setName] = useState("My pack");
  const [basePackId, setBasePackId] = useState("classic");
  const [renderMode, setRenderMode] = useState<"vector" | "pixel">("vector");
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [backgroundKind, setBackgroundKind] = useState<Bg>("dots");
  const [backgroundAssetUrl, setBackgroundAssetUrl] = useState("");
  const [colors, setColors] = useState<Record<string, string>>({});
  const [sprites, setSprites] = useState<Record<string, string>>({});
  // Per-state (status) color + sprite, keyed by VisualStatus.
  const [statusColors, setStatusColors] = useState<Record<string, string>>({});
  const [statusSprites, setStatusSprites] = useState<Record<string, string>>({});
  // Simple mode shows the six core states; advanced reveals all 16.
  const [showAllStates, setShowAllStates] = useState(false);
  // Background image filters/tint (only meaningful for an `image` background).
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const patchFilter = (patch: Partial<FilterState>) =>
    setFilter((f) => ({ ...f, ...patch }));

  // Seed all editable fields from a concrete pack (a base pack in create mode,
  // or the pack being edited in edit mode). Sprites/background are reverse-mapped
  // from the pack's `assetRef`s back to their capability URLs.
  const seedFrom = (pack: ThemePack) => {
    setColors(
      Object.fromEntries(NODE_KINDS.map((k) => [k, pack.kinds[k].color])),
    );
    setSprites(
      Object.fromEntries(
        NODE_KINDS.map((k) => {
          const ref = pack.kinds[k].assetRef;
          return [k, ref ? (pack.assets[ref]?.url ?? "") : ""];
        }),
      ),
    );
    // Per-state color + sprite for every VisualStatus (the simple-mode UI only
    // surfaces the core six but we seed all so advanced mode is ready).
    setStatusColors(
      Object.fromEntries(VISUAL_STATUSES.map((s) => [s, pack.statuses[s].color])),
    );
    setStatusSprites(
      Object.fromEntries(
        VISUAL_STATUSES.map((s) => {
          const ref = pack.statuses[s].assetRef;
          return [s, ref ? (pack.assets[ref]?.url ?? "") : ""];
        }),
      ),
    );
    setRenderMode(pack.renderMode);
    setMotionEnabled(pack.motion.enabled);
    setBackgroundKind(pack.background.kind as Bg);
    const bgRef = pack.background.assetRef;
    setBackgroundAssetUrl(bgRef ? (pack.assets[bgRef]?.url ?? "") : "");
    const f = pack.background.filter;
    setFilter({
      blur: f?.blur ?? DEFAULT_FILTER.blur,
      brightness: f?.brightness ?? DEFAULT_FILTER.brightness,
      contrast: f?.contrast ?? DEFAULT_FILTER.contrast,
      saturate: f?.saturate ?? DEFAULT_FILTER.saturate,
      grayscale: f?.grayscale ?? DEFAULT_FILTER.grayscale,
      opacity: f?.opacity ?? DEFAULT_FILTER.opacity,
      tintColor: f?.tintColor ?? DEFAULT_FILTER.tintColor,
      tintOpacity: f?.tintOpacity ?? DEFAULT_FILTER.tintOpacity,
    });
  };

  // EDIT: seed from the pack being edited whenever it (or the dialog) opens.
  useEffect(() => {
    if (!open || !editPack) return;
    setName(editPack.name);
    seedFrom(editPack);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed on open / pack change
  }, [open, editPack?.id]);

  // CREATE: honor an initial base pack when the dialog opens ("Customize" a built-in).
  useEffect(() => {
    if (!open || editPack) return;
    if (initialBasePackId && initialBasePackId !== basePackId) {
      setBasePackId(initialBasePackId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when opening in create mode
  }, [open, editPack, initialBasePackId]);

  // CREATE: (re)seed colors / renderMode / background from the chosen base pack.
  useEffect(() => {
    if (editPack) return; // edit mode seeds from editPack instead
    seedFrom(resolveBase(basePackId));
    setSprites({}); // base packs expose no user sprites to inherit in the UI
    setStatusSprites({}); // ditto for per-state sprites
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only on base change
  }, [basePackId, editPack]);

  const onSave = () => {
    // A per-state override honoring the same null/undefined sprite contract as
    // kinds: edit mode sends `null` to CLEAR a removed sprite; create sends
    // `undefined` to inherit whatever the base pack had.
    const makeStatusOverride = (status: VisualStatus): CustomStatusOverride => {
      const spriteUrl = statusSprites[status];
      return {
        color: statusColors[status],
        assetUrl: isEdit ? (spriteUrl ? spriteUrl : null) : spriteUrl || undefined,
        pixelated: renderMode === "pixel",
      };
    };

    // Build the per-state draft. Advanced (show-all) mode edits every status
    // independently; simple mode edits the six core states and mirrors each
    // onto its runtime aliases (e.g. running→starting, success→completed).
    const statuses: CustomPackDraft["statuses"] = {};
    if (showAllStates) {
      for (const s of VISUAL_STATUSES) statuses[s] = makeStatusOverride(s);
    } else {
      for (const core of CORE_STATUSES) {
        const ov = makeStatusOverride(core);
        for (const member of STATUS_ALIAS_GROUPS[core]) statuses[member] = ov;
      }
    }

    // Compose the background filter, omitting neutral (no-op) values so a pack
    // without adjustments stays clean. Tint travels only when it's visible.
    const buildFilter = (): BackgroundFilterConfig | undefined => {
      const f: BackgroundFilterConfig = {};
      if (filter.blur > 0) f.blur = filter.blur;
      if (filter.brightness !== 1) f.brightness = filter.brightness;
      if (filter.contrast !== 1) f.contrast = filter.contrast;
      if (filter.saturate !== 1) f.saturate = filter.saturate;
      if (filter.grayscale > 0) f.grayscale = filter.grayscale;
      if (filter.opacity !== 1) f.opacity = filter.opacity;
      if (filter.tintOpacity > 0) {
        f.tintColor = filter.tintColor;
        f.tintOpacity = filter.tintOpacity;
      }
      return Object.keys(f).length > 0 ? f : undefined;
    };

    const draft: CustomPackDraft = {
      name: name.trim() || "Untitled pack",
      basePackId,
      renderMode,
      motionEnabled,
      background: {
        kind: backgroundKind,
        assetUrl: backgroundKind === "image" ? backgroundAssetUrl : undefined,
        pixelated: renderMode === "pixel",
        filter: backgroundKind === "image" ? buildFilter() : undefined,
      },
      kinds: Object.fromEntries(
        NODE_KINDS.map((k) => [
          k,
          {
            color: colors[k],
            // Edit mode sends `null` to CLEAR a removed sprite; create mode sends
            // `undefined` to inherit whatever the base pack had.
            assetUrl: isEdit
              ? sprites[k]
                ? sprites[k]
                : null
              : sprites[k] || undefined,
            pixelated: renderMode === "pixel",
          },
        ]),
      ) as CustomPackDraft["kinds"],
      statuses,
    };

    const base = editPack ?? resolveBase(basePackId);
    let pack: ThemePack;
    try {
      pack = buildCustomPack(base, draft);
    } catch {
      toast("Pack is invalid — check colors and assets", "error");
      return;
    }
    if (backgroundKind === "image" && !backgroundAssetUrl) {
      toast("Pick a background image or choose a non-image background", "error");
      return;
    }
    if (editPack) {
      updatePack.mutate({ id: editPack.id, name: draft.name, pack });
    } else {
      create.mutate({ name: draft.name, pack });
    }
  };

  /** Sprite/background <option>s — always includes the current value so an
   * existing (e.g. inherited) selection is never silently dropped. */
  const assetOptionsFor = (current: string) => {
    const known = !current || assets.some((a) => a.url === current);
    return (
      <>
        <option value="">None</option>
        {assets.map((a) => (
          <option key={a.id} value={a.url}>
            {a.name}
          </option>
        ))}
        {!known ? (
          <option value={current}>{current.split("/").pop() || "Current"}</option>
        ) : null}
      </>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit pack" : "Create custom pack"}
      widthClassName="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Pack name"
            className="rounded-sm border border-border bg-surface px-2.5 py-1.5 text-xs text-content focus:border-accent focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          {isEdit ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Base pack</span>
              <span className="truncate rounded-sm border border-border bg-panel-raised px-2 py-1.5 text-xs text-faint">
                Editing this pack
              </span>
            </div>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Base pack</span>
              <select
                value={basePackId}
                onChange={(e) => setBasePackId(e.target.value)}
                aria-label="Base pack"
                className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-content"
              >
                {baseOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Render mode</span>
            <select
              value={renderMode}
              onChange={(e) => setRenderMode(e.target.value as "vector" | "pixel")}
              aria-label="Render mode"
              className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-content"
            >
              <option value="vector">Vector (smooth)</option>
              <option value="pixel">Pixel (crisp)</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Background</span>
            <select
              value={backgroundKind}
              onChange={(e) => setBackgroundKind(e.target.value as Bg)}
              aria-label="Background"
              className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-content"
            >
              <option value="dots">Dots</option>
              <option value="lines">Lines</option>
              <option value="cross">Cross</option>
              <option value="none">None</option>
              <option value="image">Image</option>
            </select>
          </label>
          {backgroundKind === "image" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Background image</span>
              <select
                value={backgroundAssetUrl}
                onChange={(e) => setBackgroundAssetUrl(e.target.value)}
                aria-label="Background image"
                className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-content"
              >
                {assetOptionsFor(backgroundAssetUrl)}
              </select>
            </label>
          )}
        </div>

        {backgroundKind === "image" && (
          <div className="flex flex-col gap-2 rounded-sm border border-border bg-panel-raised/40 p-3">
            <span className="text-xs font-medium text-muted">
              Background image filters
            </span>
            <FilterSlider
              label="Blur"
              aria="Background blur"
              min={0}
              max={20}
              step={0.5}
              value={filter.blur}
              suffix="px"
              onChange={(v) => patchFilter({ blur: v })}
            />
            <FilterSlider
              label="Brightness"
              aria="Background brightness"
              min={0}
              max={2}
              step={0.05}
              value={filter.brightness}
              onChange={(v) => patchFilter({ brightness: v })}
            />
            <FilterSlider
              label="Contrast"
              aria="Background contrast"
              min={0}
              max={2}
              step={0.05}
              value={filter.contrast}
              onChange={(v) => patchFilter({ contrast: v })}
            />
            <FilterSlider
              label="Saturation"
              aria="Background saturation"
              min={0}
              max={2}
              step={0.05}
              value={filter.saturate}
              onChange={(v) => patchFilter({ saturate: v })}
            />
            <FilterSlider
              label="Grayscale"
              aria="Background grayscale"
              min={0}
              max={1}
              step={0.05}
              value={filter.grayscale}
              onChange={(v) => patchFilter({ grayscale: v })}
            />
            <FilterSlider
              label="Opacity"
              aria="Background opacity"
              min={0}
              max={1}
              step={0.05}
              value={filter.opacity}
              onChange={(v) => patchFilter({ opacity: v })}
            />
            <div className="grid grid-cols-[5rem_auto_1fr] items-center gap-2">
              <span className="text-xs text-content">Tint</span>
              <input
                type="color"
                value={filter.tintColor}
                aria-label="Background tint color"
                onChange={(e) => patchFilter({ tintColor: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded-sm border border-border bg-surface"
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={filter.tintOpacity}
                aria-label="Background tint opacity"
                onChange={(e) => patchFilter({ tintOpacity: Number(e.target.value) })}
                className="min-w-0"
              />
            </div>
            <p className="text-[11px] text-faint">
              Tune the uploaded backdrop and add a tint wash so nodes stay
              readable over a busy image.
            </p>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={motionEnabled}
            onChange={(e) => setMotionEnabled(e.target.checked)}
          />
          Enable motion
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted">Per-kind color &amp; sprite</span>
          {NODE_KINDS.map((k: NodeKind) => (
            <div key={k} className="grid grid-cols-[5rem_auto_1fr] items-center gap-2">
              <span className="text-xs capitalize text-content">{k}</span>
              <input
                type="color"
                value={colors[k] ?? "#646b7a"}
                onChange={(e) =>
                  setColors((c) => ({ ...c, [k]: e.target.value }))
                }
                aria-label={`${k} color`}
                className="h-7 w-10 cursor-pointer rounded-sm border border-border bg-surface"
              />
              <select
                value={sprites[k] ?? ""}
                onChange={(e) =>
                  setSprites((s) => ({ ...s, [k]: e.target.value }))
                }
                aria-label={`${k} sprite`}
                className="min-w-0 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-content"
              >
                {assetOptionsFor(sprites[k] ?? "")}
              </select>
            </div>
          ))}
          {assets.length === 0 && (
            <p className="text-[11px] text-faint">
              Import images in the &ldquo;Imported assets&rdquo; section to use them
              as sprites.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">
              Per-state color &amp; sprite
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showAllStates}
              aria-label="Show all states"
              onClick={() => setShowAllStates((v) => !v)}
              className={[
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                showAllStates
                  ? "border-accent/60 bg-accent/10 text-content"
                  : "border-border bg-surface text-muted hover:border-border-strong",
              ].join(" ")}
            >
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  showAllStates ? "bg-accent" : "bg-faint",
                ].join(" ")}
              />
              {showAllStates ? "All states" : "Core states"}
            </button>
          </div>
          {showAllStates ? (
            <p className="text-[11px] text-warning">
              Advanced: theming all {VISUAL_STATUSES.length} states is a busier UI.
              Core mode maps runtime aliases for you (e.g. starting→running,
              completed→success).
            </p>
          ) : (
            <p className="text-[11px] text-faint">
              These six states cover every run. Runtime aliases (starting,
              completed, queued) inherit their core state automatically.
            </p>
          )}
          {(showAllStates ? VISUAL_STATUSES : CORE_STATUSES).map((s) => (
            <div key={s} className="grid grid-cols-[5rem_auto_1fr] items-center gap-2">
              <span className="truncate text-xs capitalize text-content">{s}</span>
              <input
                type="color"
                value={statusColors[s] ?? "#646b7a"}
                onChange={(e) =>
                  setStatusColors((c) => ({ ...c, [s]: e.target.value }))
                }
                aria-label={`${s} state color`}
                className="h-7 w-10 cursor-pointer rounded-sm border border-border bg-surface"
              />
              <select
                value={statusSprites[s] ?? ""}
                onChange={(e) =>
                  setStatusSprites((p) => ({ ...p, [s]: e.target.value }))
                }
                aria-label={`${s} state sprite`}
                className="min-w-0 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-content"
              >
                {assetOptionsFor(statusSprites[s] ?? "")}
              </select>
            </div>
          ))}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            loading={create.isPending || updatePack.isPending}
            onClick={onSave}
          >
            {isEdit ? "Save changes" : "Create pack"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** A labeled range slider with a live numeric readout, used for bg filters. */
function FilterSlider({
  label,
  aria,
  min,
  max,
  step,
  value,
  suffix,
  onChange,
}: {
  label: string;
  aria: string;
  min: number;
  max: number;
  step: number;
  value: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-2">
      <span className="text-xs text-content">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={aria}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0"
      />
      <span className="text-right text-[11px] tabular-nums text-faint">
        {value}
        {suffix ?? ""}
      </span>
    </div>
  );
}
