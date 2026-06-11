"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers/app";

// Same-origin tRPC client. Auth attaches a FRESH Clerk session token (getToken)
// as `Authorization: Bearer …` on every request. The pure clerk-react SPA SDK
// does NOT keep the `__session` cookie fresh for server reads (no clerkMiddleware),
// so relying on the cookie alone yields stale/expired tokens the BFF rejects. The
// server prefers the Bearer header over the cookie. Dev-auth bypass still works.
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") return new QueryClient();
  browserQueryClient ??= new QueryClient();
  return browserQueryClient;
}

function getUrl() {
  const base =
    typeof window !== "undefined"
      ? ""
      : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  return `${base}/api/trpc`;
}

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  // Capture Clerk's getToken in a ref so the (stable) link closure always calls
  // the latest one for a fresh JWT.
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          transformer: superjson,
          url: getUrl(),
          async headers() {
            // Dev bypass (local-only) — unchanged.
            const devUser = process.env.NEXT_PUBLIC_DEV_AUTH_USER;
            if (
              process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === "1" &&
              process.env.NODE_ENV !== "production" &&
              devUser
            ) {
              return { authorization: `Bearer dev_${devUser}` };
            }
            // Real Clerk: forward a fresh session token; the BFF verifies it.
            try {
              const token = await getTokenRef.current();
              if (token) return { authorization: `Bearer ${token}` };
            } catch {
              // Not signed in / token unavailable → send no header (server 401s).
            }
            return {};
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
