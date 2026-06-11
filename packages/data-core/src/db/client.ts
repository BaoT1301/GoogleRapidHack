import mongoose from "mongoose";

/**
 * MongoDB connection helper.
 *
 * Uses a `globalThis` singleton so that:
 *  - Next.js dev HMR does not open a new connection on every module reload, and
 *  - `next start` (single long-lived process) reuses one pool across requests.
 *
 * The runtime (Stephen) imports the same models that depend on this connection,
 * so everything shares one Mongoose connection per process.
 */

// Tests (vitest) run destructive deleteMany — NEVER point them at the shared
// Atlas cluster. Prefer MONGODB_TEST_URI, then a local Mongo, only then the app URI.
const MONGODB_URI = process.env.VITEST
  ? process.env.MONGODB_TEST_URI ?? "mongodb://localhost:27017/orchestrator_test"
  : process.env.MONGODB_URI ?? "mongodb://localhost:27017/orchestrator";

function describeMongoUri(uri: string): string {
  const hostKind = uri.includes("mongodb.net")
    ? "atlas"
    : uri.includes("localhost") || uri.includes("127.0.0.1")
      ? "local"
      : "custom";
  const dbName = uri.match(/\/([^/?]+)(?:\?|$)/)?.[1] ?? "unknown-db";
  return `${hostKind}:${dbName}`;
}

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalForMongoose = globalThis as unknown as {
  __orchestratorMongoose?: MongooseCache;
};

const cache: MongooseCache =
  globalForMongoose.__orchestratorMongoose ?? { conn: null, promise: null };

globalForMongoose.__orchestratorMongoose = cache;

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      })
      .then((m) => {
        console.log(`[db] Connected to MongoDB (${describeMongoUri(MONGODB_URI)})`);
        return m;
      });
  }

  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null;
    const error = err as { name?: string; code?: unknown };
    console.error(
      `[db] MongoDB connection failed (${describeMongoUri(MONGODB_URI)}): ${error.name ?? "Error"}${
        error.code ? ` code=${error.code}` : ""
      }`,
    );
    throw err;
  }

  return cache.conn;
}

export async function disconnectDB(): Promise<void> {
  if (!cache.conn) return;
  await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
}

export function isDBConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
