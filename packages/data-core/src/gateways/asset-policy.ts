// Asset validation policy — framework / DB / Mongoose-free.
//
// Imported by BOTH server code (the auth-bff + orchestrator routers, defense in
// depth) and CLIENT code (the canvas Settings panel's <AssetManager>). Keeping
// this file free of Mongoose / connectDB / model imports is what lets the
// browser bundle pull it in without dragging Atlas connection code along, which
// would crash with `Cannot read properties of undefined (reading 'CanvasAsset')`
// inside Webpack's app-pages-browser layer.
//
// `gateways/asset-gateway.ts` re-exports these values for convenience on the
// server side; new client imports should target this module directly.

/** Allowed asset MIME types (raster sprites + svg vectors). */
export const ALLOWED_ASSET_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;
export type AssetContentType = (typeof ALLOWED_ASSET_TYPES)[number];

/** Max stored bytes per asset (sprites/tiles are small). */
export const MAX_ASSET_BYTES = 1_000_000; // 1 MB

export interface AssetValidationInput {
  contentType: string;
  size: number;
}
export interface AssetValidationResult {
  ok: boolean;
  reason?: string;
}

export function isAllowedAssetType(t: string): t is AssetContentType {
  return (ALLOWED_ASSET_TYPES as readonly string[]).includes(t);
}

export function validateAsset(input: AssetValidationInput): AssetValidationResult {
  if (!isAllowedAssetType(input.contentType)) {
    return { ok: false, reason: `Unsupported type: ${input.contentType}` };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, reason: "Empty asset" };
  }
  if (input.size > MAX_ASSET_BYTES) {
    return {
      ok: false,
      reason: `Asset too large (${input.size} > ${MAX_ASSET_BYTES} bytes)`,
    };
  }
  return { ok: true };
}

/** Where the canvas loads bytes — the orchestrator route (token-forwarding proxy). */
export function assetCapabilityUrl(id: string): string {
  return `/api/assets/${id}`;
}
