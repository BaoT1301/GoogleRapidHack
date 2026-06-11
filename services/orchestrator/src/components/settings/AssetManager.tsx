"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TrashIcon, UploadSimpleIcon, ImageIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import {
  ALLOWED_ASSET_TYPES,
  MAX_ASSET_BYTES,
  isAllowedAssetType,
} from "@/server/assets/validate";

interface AssetMeta {
  id: string;
  name: string;
  contentType: string;
  size: number;
  pixelated?: boolean;
  url: string;
}

/** Read a File into base64 (without the `data:...;base64,` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/**
 * Import + manage user assets (theme-pack sprites / backgrounds). Uploads go to
 * the DB-backed `assets` router; each asset gets a capability URL served by
 * `/api/assets/[id]`. Copy an asset's id to reference it from a custom pack's
 * `assetRef` (e.g. an imported sprite or background tile).
 */
export function AssetManager({ enabled = true }: { enabled?: boolean }) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pixelated, setPixelated] = useState(true);

  const assets = useQuery(trpc.assets.list.queryOptions(undefined, { enabled }));
  const upload = useMutation(
    trpc.assets.upload.mutationOptions({
      onSuccess: () => {
        assets.refetch();
        toast("Asset imported", "success");
      },
      onError: (e: unknown) =>
        toast(e instanceof Error ? e.message : "Upload failed", "error"),
    }),
  );
  const remove = useMutation(
    trpc.assets.remove.mutationOptions({ onSuccess: () => assets.refetch() }),
  );

  const list = (assets.data as AssetMeta[] | undefined) ?? [];

  const onPick = () => fileInput.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!isAllowedAssetType(file.type)) {
      toast(`Unsupported type: ${file.type || "unknown"}`, "error");
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      toast(`Too large (max ${formatBytes(MAX_ASSET_BYTES)})`, "error");
      return;
    }
    try {
      const dataBase64 = await fileToBase64(file);
      upload.mutate({
        name: file.name,
        contentType: file.type as (typeof ALLOWED_ASSET_TYPES)[number],
        dataBase64,
        pixelated,
      });
    } catch {
      toast("Could not read the file", "error");
    }
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard?.writeText(id);
      toast("Asset id copied", "success");
    } catch {
      /* clipboard unavailable — non-fatal */
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted">
          Imported assets
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={pixelated}
            aria-label="Pixelated rendering for imports"
            onClick={() => setPixelated((p) => !p)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              pixelated
                ? "border-accent/60 bg-accent/10 text-content"
                : "border-border bg-surface text-muted hover:border-border-strong",
            ].join(" ")}
          >
            {pixelated ? "Pixel-art" : "Smooth"}
          </button>
          <Button size="sm" variant="ghost" loading={upload.isPending} onClick={onPick}>
            <UploadSimpleIcon size={13} /> Import
          </Button>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={ALLOWED_ASSET_TYPES.join(",")}
        className="hidden"
        aria-label="Import asset file"
        onChange={onFile}
      />

      {list.length === 0 ? (
        <p className="flex items-center gap-2 rounded-sm border border-dashed border-border px-3 py-4 text-xs text-faint">
          <ImageIcon size={15} />
          No assets yet. Import a PNG, WebP, GIF, JPEG, or SVG (max{" "}
          {formatBytes(MAX_ASSET_BYTES)}) to use as a sprite or background in a
          custom theme pack.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {list.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-sm border border-border bg-surface p-2"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded bg-panel-raised">
                {/* eslint-disable-next-line @next/next/no-img-element -- dynamic capability URL */}
                <img
                  src={a.url}
                  alt={a.name}
                  className="h-8 w-8 object-contain"
                  style={a.pixelated ? { imageRendering: "pixelated" } : undefined}
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-content" title={a.name}>
                  {a.name}
                </p>
                <button
                  type="button"
                  onClick={() => copyId(a.id)}
                  className="truncate font-mono text-[10px] text-faint hover:text-muted"
                  title="Click to copy asset id"
                >
                  {a.id} · {formatBytes(a.size)}
                </button>
              </div>
              <button
                type="button"
                aria-label={`Delete ${a.name}`}
                onClick={() => remove.mutate({ id: a.id })}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <TrashIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
