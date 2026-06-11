// Orchestrator service-auth — supplies the X-Service-Token for the trusted svc.*
// BFF path WITHOUT shipping a shared secret (auth-bff-api.md §10).
//
// Replaces the shared BFF_SERVICE_TOKEN god-key with a PER-USER run token minted by
// the BFF from the signed-in user's own Clerk token. The orchestrator process is
// single-user (one logged-in user per desktop app), so a module-level cache of "the
// current user + a minted run token" is correct. Falls back to BFF_SERVICE_TOKEN when
// it is set (dev / before the BFF is redeployed) so nothing breaks mid-rollout.
import { createBffClient } from "./client";

/** Re-mint this many ms before expiry so a call never races the boundary. */
const REMINT_SKEW_MS = 5 * 60_000;

let currentUserId: string | null = null;
let currentUserToken: string | null = null;
let cached: { token: string; userId: string; expMs: number } | null = null;
let inflight: Promise<string | null> | null = null;

/**
 * Record the freshest Clerk identity from an authed request (called by
 * createTRPCContext) or at run start. The run token is minted from this. A new user
 * invalidates the cached token.
 */
export function noteUserAuth(userId: string | null, token: string | null): void {
  if (!userId || !token) return;
  if (userId !== currentUserId) cached = null;
  currentUserId = userId;
  currentUserToken = token;
}

/** Legacy shared token (signing key on the BFF; only a fallback credential here). */
function legacyToken(): string | null {
  const t = process.env.BFF_SERVICE_TOKEN;
  return t && t.length > 0 ? t : null;
}

/**
 * Resolve the token to send as X-Service-Token for svc.* calls: a per-user run token
 * (minted + cached, re-minted before expiry) when possible, else the legacy shared
 * token. Returns null when neither is available (caller then gets UNAUTHORIZED from
 * the BFF — only happens if no user has authed and no legacy token is set).
 */
export async function resolveServiceToken(): Promise<string | null> {
  const bffUrl = process.env.BFF_URL;
  if (!bffUrl || process.env.ORCH_BFF_RUN_TOKEN === "false") return legacyToken();

  const now = Date.now();
  if (cached && cached.userId === currentUserId && cached.expMs - REMINT_SKEW_MS > now) {
    return cached.token;
  }
  // Need a Clerk identity to mint from; without one, fall back to the legacy token.
  const clerkToken = currentUserToken;
  const userId = currentUserId;
  if (!clerkToken || !userId) return legacyToken();

  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await createBffClient(bffUrl, clerkToken).auth.mintRunToken.mutate();
        cached = { token: res.token, userId, expMs: new Date(res.expiresAt).getTime() };
        return res.token;
      } catch {
        // Old BFF (no mintRunToken yet) / network hiccup → legacy token keeps us working.
        return legacyToken();
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/** Test-only: clear the module cache between cases. */
export function __resetServiceAuthForTest(): void {
  currentUserId = null;
  currentUserToken = null;
  cached = null;
  inflight = null;
}
