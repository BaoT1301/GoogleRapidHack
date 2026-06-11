import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { connectDB } from "../db/client";

/**
 * tRPC context + procedures.
 *
 * Auth resolves a `userId` two ways (ADR AD-3 + the build-now/Clerk-later plan):
 *   1. Real Clerk cookie auth via `currentUser()`/`auth()` — ONLY when CLERK_SECRET_KEY
 *      is configured. This is the production/desktop path (same-origin, cookie-based).
 *   2. Dev bypass — `Authorization: Bearer dev_<userId>` — only when ALLOW_DEV_AUTH=1
 *      and NODE_ENV !== production. Lets us build/test every router before real keys exist.
 *      NEVER enable in production.
 */
export interface Context {
  userId: string | null;
  /**
   * The user's OWN bearer token, captured so a procedure can forward it to the
   * cloud BFF/conductor (CC2) — the BFF re-verifies it and scopes by userId. This
   * is the user's token, never a service secret. Null when unauthenticated. Nothing
   * reads it unless BFF delegation is enabled, so it is fully additive.
   */
  token?: string | null;
}

/** Extract the user's raw token from a request: Bearer header, else __session cookie. */
function extractToken(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice("Bearer ".length).trim();
    if (t) return t;
  }
  const cookie = headers.get("cookie");
  if (cookie) {
    const m = /(?:^|;\s*)__session=([^;]+)/.exec(cookie);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

export async function createTRPCContext(opts: {
  headers: Headers;
}): Promise<Context> {
  let userId: string | null = null;
  let token: string | null = null;

  // 0) BFF mode (BFF_URL set): resolve identity via the cloud BFF's auth.whoami —
  // the local app holds NO CLERK_SECRET_KEY. It forwards the user's own token; the
  // BFF verifies it and returns the userId (cached ~30s). Fully additive: this
  // branch is taken ONLY when BFF_URL is configured (P0-full). See auth-bff-api.md s3.
  if (process.env.BFF_URL) {
    token = extractToken(opts.headers);
    if (token) {
      const { resolveUserIdViaBff } = await import("../bff/whoami");
      userId = await resolveUserIdViaBff(token);
    }
    // Capture the freshest Clerk identity so the trusted svc.* path can mint a
    // per-user run token (no shared secret on the client). See auth-bff-api.md §10.
    if (userId && token) {
      const { noteUserAuth } = await import("../bff/service-auth");
      noteUserAuth(userId, token);
    }
    return { userId, token };
  }

  // 1) Real Clerk (cookie) — only when keys are present.
  if (process.env.CLERK_SECRET_KEY) {
    try {
      const { auth } = await import("@clerk/nextjs/server");
      const session = await auth();
      userId = session.userId ?? null;
      // Session JWT to forward to the BFF (which verifies it with CLERK_SECRET_KEY).
      if (userId) {
        try {
          token = (await session.getToken()) ?? null;
        } catch {
          token = null;
        }
      }
    } catch {
      // Not inside a Clerk request scope, or misconfigured — fall through to bypass.
    }
  }

  // 2) Dev bypass.
  if (
    !userId &&
    process.env.ALLOW_DEV_AUTH === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    const header = opts.headers.get("authorization");
    if (header?.startsWith("Bearer dev_")) {
      const id = header.slice("Bearer dev_".length).trim();
      userId = id.length > 0 ? id : null;
      // Forward the same dev token the BFF accepts (dev_<userId>) under ALLOW_DEV_AUTH.
      if (userId) token = `dev_${userId}`;
    }
  }

  return { userId, token };
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

/** Requires an authenticated user; narrows `ctx.userId` to `string` downstream. */
export const authedProcedure = t.procedure.use(async (opts) => {
  if (!opts.ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return opts.next({ ctx: { ...opts.ctx, userId: opts.ctx.userId } });
});

/** Authed + ensures the Mongo connection is established. Use for DB-backed procedures. */
export const dbProcedure = authedProcedure.use(async (opts) => {
  await connectDB();
  return opts.next();
});
