// Typed BFF client (Cloud Infra CC2).
//
// A tRPC client the LOCAL app uses to call the cloud Auth/BFF (conductor, and later
// the data gateways). It forwards the user's OWN bearer token as
// `Authorization: Bearer <token>`; the BFF verifies it and scopes by userId — the
// local app holds no service secret. Type-only import of BffAppRouter, so this adds
// no runtime coupling to the BFF's server-side modules. See auth-bff-api.md §3.
import { createTRPCClient, httpLink } from "@trpc/client";
import superjson from "superjson";

// NOTE: this submission repo does NOT ship the cloud auth-bff service, so the
// generated `BffAppRouter` type is not available here. The tRPC client is a
// runtime proxy, so runtime behavior is unchanged — we only relax compile-time
// inference on BFF calls by typing these clients loosely. To restore full
// end-to-end types, run against the monorepo where `@repo/auth-bff` exists.

export type BffClient = ReturnType<typeof createBffClient>;

/** Build a BFF tRPC client for `baseUrl`, forwarding the user's token (if any). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBffClient(baseUrl: string, token: string | null): any {
  const url = `${baseUrl.replace(/\/$/, "")}`;
  return createTRPCClient<any>({
    links: [
      httpLink({
        url,
        transformer: superjson,
        headers: () => (token ? { authorization: `Bearer ${token}` } : {}),
      }),
    ],
  });
}

/** A service-token source: a fixed string, or a provider resolved per request. */
export type ServiceTokenSource = string | null | (() => Promise<string | null>);

/**
 * Build a SERVICE BFF client for the trusted orchestrator → BFF path (svc.runs /
 * svc.secrets / svc.graphs). `tokenSource` is sent as `X-Service-Token`: normally a
 * per-user RUN TOKEN resolved per request (so it re-mints on expiry transparently),
 * or the legacy shared token during migration. The BFF derives ownerId from a run
 * token — see auth-bff-api.md §10. Never used from a browser.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBffServiceClient(
  baseUrl: string,
  tokenSource: ServiceTokenSource,
): any {
  const url = `${baseUrl.replace(/\/$/, "")}`;
  const resolve: () => Promise<string | null> =
    typeof tokenSource === "function" ? tokenSource : async () => tokenSource;
  return createTRPCClient<any>({
    links: [
      httpLink({
        url,
        transformer: superjson,
        headers: async () => {
          const token = await resolve();
          return token ? { "x-service-token": token } : {};
        },
      }),
    ],
  });
}
