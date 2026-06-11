// Liveness probe — no auth, no DB. Confirms the server process is up.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "orchestrator",
    timestamp: new Date().toISOString(),
  });
}
