import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/routers/app";
import { createTRPCContext } from "@/server/init";

// Same-origin tRPC endpoint (Crushie pattern). Auth comes from the request:
// Clerk cookie (prod) or the dev bypass header.
export const dynamic = "force-dynamic";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
  });

export { handler as GET, handler as POST };
