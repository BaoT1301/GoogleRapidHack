import { connectDB, isDBConnected } from "@/db/client";

// Readiness probe — checks the dependency the app needs to actually serve traffic:
// the database. In BFF mode (BFF_URL set) the app never connects to Mongo directly —
// the DB is reached THROUGH the cloud BFF — so we check the BFF's reachability
// instead of pinging a local Mongo that isn't used. Otherwise (direct mode) we ping
// Mongo as before.
export const dynamic = "force-dynamic";

export async function GET() {
  const bffUrl = process.env.BFF_URL?.replace(/\/$/, "");

  if (bffUrl) {
    let mongo = false; // "DB reachable" — here, via the BFF
    try {
      const res = await fetch(`${bffUrl}/health`, { signal: AbortSignal.timeout(4000) });
      mongo = res.ok;
    } catch {
      mongo = false;
    }
    return Response.json(
      { ready: mongo, checks: { mongo, via: "bff" }, timestamp: new Date().toISOString() },
      { status: mongo ? 200 : 503 },
    );
  }

  try {
    await connectDB();
  } catch {
    // swallow — reported via the checks below
  }
  const mongo = isDBConnected();
  return Response.json(
    { ready: mongo, checks: { mongo }, timestamp: new Date().toISOString() },
    { status: mongo ? 200 : 503 },
  );
}
