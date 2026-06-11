import { getRunGateway } from "@/server/data/run-gateway";
import { createTRPCContext } from "@/server/init";
import { sseHub } from "@/server/sse/hub";

// SSE stream of all events for a run. Same-origin → cookie auth (or dev bypass).
// LA: `new EventSource('/api/runs/' + runId + '/events')` (cookie rides along).
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // mongoose needs Node runtime, not edge

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const { userId: contextUserId } = await createTRPCContext({ headers: req.headers });
  const userId = contextUserId ?? devUserIdFromUrl(req.url);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  // Ownership check via the run gateway (BFF in BFF mode; direct Mongo otherwise) —
  // the live events themselves stream from the in-process sseHub below.
  const run = await getRunGateway().getById(userId, runId);
  if (!run) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let keepalive: ReturnType<typeof setInterval>;
  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const client = {
        write: (data: string) => {
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            // stream already closed
          }
        },
      };

      client.write(": connected\n\n"); // open the stream immediately
      unsubscribe = sseHub.subscribe(runId, client);
      keepalive = setInterval(() => client.write(": keepalive\n\n"), 15_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      clearInterval(keepalive);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function devUserIdFromUrl(url: string): string | null {
  if (
    process.env.ALLOW_DEV_AUTH !== "1" ||
    process.env.NODE_ENV === "production"
  ) {
    return null;
  }
  const value = new URL(url).searchParams.get("dev_user");
  if (!value) return null;
  return value.startsWith("dev_") ? value.slice("dev_".length) : value;
}
