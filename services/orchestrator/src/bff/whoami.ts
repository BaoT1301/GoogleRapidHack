// BFF-mode identity (Cloud Infra P0-full).
//
// When BFF_URL is set, the local app does NOT hold CLERK_SECRET_KEY, so it cannot
// verify a token itself. Instead it forwards the user's raw token to the BFF's
// `auth.whoami`, which verifies it (with the secret, cloud-side) and returns the
// userId. A short-TTL in-process cache keyed by token avoids a round-trip on every
// request. See auth-bff-api.md s3.
import { createBffClient } from "./client";

interface CacheEntry {
  userId: string | null;
  exp: number;
}

const TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

/** Resolve a forwarded token to a userId via the BFF (cached ~30s). Never throws. */
export async function resolveUserIdViaBff(
  token: string,
  baseUrl: string | undefined = process.env.BFF_URL,
): Promise<string | null> {
  if (!baseUrl || !token) return null;
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.exp > now) return hit.userId;

  let userId: string | null = null;
  try {
    const res = await createBffClient(baseUrl, token).auth.whoami.query();
    userId = res.userId ?? null;
  } catch {
    userId = null; // bad/expired token or BFF unreachable → unauthenticated
  }
  cache.set(token, { userId, exp: now + TTL_MS });
  return userId;
}

/** Test/maintenance hook — clear the whoami cache. */
export function __clearWhoamiCache(): void {
  cache.clear();
}
