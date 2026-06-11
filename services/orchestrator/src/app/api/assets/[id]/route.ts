import { connectDB } from "@/db/client";
import { CanvasAssetModel } from "@/db/models/canvas-asset.model";

// Serves canvas asset bytes by id.
//
// BFF mode (BFF_URL set) — token-forwarding proxy.
//   The browser loads assets via `<img src="/api/assets/<id>">`, which can't
//   attach an Authorization header. We pull the user's Clerk session token from
//   the `__session` cookie (same scheme `createTRPCContext` uses), forward it as
//   `Bearer <token>` to `${BFF_URL}/assets/<id>/bytes`, and stream the response
//   back. The BFF verifies the token + auto-scopes by userId, so the laptop
//   never holds Mongo creds and never sees raw bytes from Atlas.
//
// Local Mongo mode (no BFF_URL) — preserved capability URL behavior.
//   Reads bytes directly from Mongo without auth: the ulid id is unguessable,
//   and assets are non-sensitive presentational images. Identical to the
//   pre-migration behavior so unit tests + offline dev keep working.
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // mongoose / fetch streaming both need Node runtime

/** Pull the user's bearer-form token from the request: header > __session cookie. */
function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice("Bearer ".length).trim();
    if (t) return t;
  }
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const m = /(?:^|;\s*)__session=([^;]+)/.exec(cookie);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

/** Headers we always emit (or pass through from the BFF) on a successful 200. */
function commonImageHeaders(contentType: string, contentLength: string): Headers {
  return new Headers({
    "Content-Type": contentType,
    "Content-Length": contentLength,
    // Immutable: an asset's bytes never change (a new upload gets a new id).
    "Cache-Control": "public, max-age=31536000, immutable",
    // Defense-in-depth for image/svg+xml: prevent MIME sniffing + lock down
    // any embedded resources/scripts.
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const bffUrl = process.env.BFF_URL;
  if (bffUrl) {
    const token = extractToken(req);
    if (!token) return new Response("Unauthorized", { status: 401 });

    const upstream = await fetch(
      `${bffUrl.replace(/\/$/, "")}/assets/${encodeURIComponent(id)}/bytes`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    // Map BFF status codes through; only 200 streams bytes back.
    if (upstream.status === 401) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (upstream.status === 404) {
      return new Response("Not found", { status: 404 });
    }
    if (!upstream.ok || !upstream.body) {
      return new Response("Upstream error", { status: 502 });
    }

    // Pass through Content-Type + Content-Length from upstream; force the same
    // cache + CSP headers the local mongo path used to emit (defense in depth
    // — the BFF emits identical headers, so this is belt-and-suspenders).
    const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
    const cl = upstream.headers.get("content-length") ?? "";
    return new Response(upstream.body, { status: 200, headers: commonImageHeaders(ct, cl) });
  }

  // Local Mongo fallback (BFF_URL unset) — preserves the capability-URL model.
  // Metadata in Mongo; bytes in GCS (object store). Legacy assets may still carry
  // inline Mongo bytes, so fall back to those when GCS has nothing/ isn't configured.
  await connectDB();
  const doc = await CanvasAssetModel.findById(id).lean();
  if (!doc) return new Response("Not found", { status: 404 });

  let bytes: Buffer | null = null;
  try {
    const { getAssetStorage, assetStorageKey } = await import(
      "@repo/data-core/storage/asset-storage"
    );
    bytes = await getAssetStorage().get(assetStorageKey(doc.ownerId, id));
  } catch {
    // GCS not configured for local dev → fall through to any inline bytes.
  }
  bytes ??= (doc.data as unknown as Buffer | undefined) ?? null;
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: commonImageHeaders(doc.contentType, String(doc.size)),
  });
}
