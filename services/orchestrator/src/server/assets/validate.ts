// Re-export shim → @repo/data-core/gateways/asset-policy.
//
// IMPORTANT: import from `asset-policy` (Mongoose-free) here, NOT from
// `asset-gateway` — this file is reached from CLIENT components (e.g. the
// canvas Settings panel's <AssetManager>), and the gateway module pulls in the
// Mongoose CanvasAssetModel + connectDB, which crashes the browser bundle with
// `Cannot read properties of undefined (reading 'CanvasAsset')`.
//
// New code should import from `@repo/data-core/gateways/asset-policy` directly.
export {
  ALLOWED_ASSET_TYPES,
  MAX_ASSET_BYTES,
  isAllowedAssetType,
  validateAsset,
  assetCapabilityUrl as assetUrl,
} from "@repo/data-core/gateways/asset-policy";
export type {
  AssetContentType,
  AssetValidationInput,
  AssetValidationResult,
} from "@repo/data-core/gateways/asset-policy";
