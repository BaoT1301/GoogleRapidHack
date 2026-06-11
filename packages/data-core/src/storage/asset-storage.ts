// Asset blob storage abstraction for user-imported canvas assets (theme-pack
// sprites / backgrounds). Bytes live in a private object store (GCS); Mongo keeps
// metadata only. Shared in data-core so BOTH the orchestrator (local Mongo mode)
// and the auth-bff service use one implementation. The abstraction keeps the
// gateway free of SDK details and lets tests swap in an in-memory fake.
//
// Auth: the GCS implementation relies on Application Default Credentials (ADC) —
// `gcloud auth application-default login` locally, or the attached service account
// in Cloud Run. No JSON key is read here (org policy may disable SA keys).

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface PutAssetInput {
  /** Object key (see `assetStorageKey`). */
  key: string;
  contentType: string;
  bytes: Buffer | Uint8Array;
}

export interface AssetStorage {
  /** Write (or overwrite) the object's bytes. */
  put(input: PutAssetInput): Promise<void>;
  /** Full object bytes, or `null` when the object is absent. */
  get(key: string): Promise<Buffer | null>;
  /** Delete the object. No-op if it does not exist. */
  delete(key: string): Promise<void>;
}

/**
 * Object key for an asset's bytes. Owner-scoped so a bucket-level listing/audit
 * stays tenant-partitioned; the ulid id keeps it unguessable. Pure (no SDK).
 */
export function assetStorageKey(ownerId: string, id: string): string {
  return `assets/${ownerId}/${id}`;
}

/**
 * GCS-backed implementation. The `Storage` client is created lazily on first use
 * so importing this module (and tests using the fake) never requires credentials
 * or network access. `@google-cloud/storage` is imported dynamically so it is only
 * loaded when GCS is actually used.
 */
class GcsAssetStorage implements AssetStorage {
  private clientPromise: Promise<import("@google-cloud/storage").Bucket> | null =
    null;

  constructor(
    private readonly bucketName: string,
    private readonly projectId?: string,
  ) {}

  private async bucket(): Promise<import("@google-cloud/storage").Bucket> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { Storage } = await import("@google-cloud/storage");
        const storage = new Storage(
          this.projectId ? { projectId: this.projectId } : {},
        );
        return storage.bucket(this.bucketName);
      })();
    }
    return this.clientPromise;
  }

  async put({ key, contentType, bytes }: PutAssetInput): Promise<void> {
    const bucket = await this.bucket();
    await bucket.file(key).save(Buffer.from(bytes), {
      contentType,
      resumable: false, // small sprites — a single request is cheaper/faster
      metadata: { cacheControl: IMMUTABLE_CACHE_CONTROL },
    });
  }

  async get(key: string): Promise<Buffer | null> {
    const bucket = await this.bucket();
    const file = bucket.file(key);
    try {
      const [contents] = await file.download();
      return contents;
    } catch (err) {
      // 404 → absent; rethrow anything else (perms/network) so callers can 5xx.
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const bucket = await this.bucket();
    await bucket.file(key).delete({ ignoreNotFound: true });
  }
}

/** In-memory fake for unit tests — no network, no credentials. */
export class FakeAssetStorage implements AssetStorage {
  private readonly store = new Map<string, { contentType: string; bytes: Buffer }>();

  async put({ key, contentType, bytes }: PutAssetInput): Promise<void> {
    this.store.set(key, { contentType, bytes: Buffer.from(bytes) });
  }

  async get(key: string): Promise<Buffer | null> {
    return this.store.get(key)?.bytes ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  // ── test helpers ──
  has(key: string): boolean {
    return this.store.has(key);
  }
  get count(): number {
    return this.store.size;
  }
}

let singleton: AssetStorage | null = null;

/**
 * Lazily-constructed process-wide storage singleton. Throws a clear error if the
 * bucket env var is missing rather than failing deep inside the SDK.
 */
export function getAssetStorage(): AssetStorage {
  if (singleton) return singleton;
  const bucket = process.env.GCS_ASSETS_BUCKET;
  if (!bucket) {
    throw new Error(
      "GCS_ASSETS_BUCKET is not set — cannot store/serve canvas assets. " +
        "Set GCP_PROJECT_ID + GCS_ASSETS_BUCKET.",
    );
  }
  singleton = new GcsAssetStorage(bucket, process.env.GCP_PROJECT_ID);
  return singleton;
}

/** Test seam: inject a fake (or reset with `null`). Never call in production. */
export function __setAssetStorageForTest(storage: AssetStorage | null): void {
  singleton = storage;
}
