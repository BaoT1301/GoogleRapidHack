import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// Single env source for the whole orchestrator: repo-root `.env.orchestrator`.
// Loaded here so `next dev`/`next start` (one Node process) sees it in route handlers.
// The packaged Electron shell injects the same vars before launching (P9).
loadEnv({ path: path.resolve(process.cwd(), "../../.env.orchestrator") });

if (
  process.env.ALLOW_DEV_AUTH === "1" &&
  process.env.NODE_ENV !== "production"
) {
  process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH ??= "1";
  process.env.NEXT_PUBLIC_DEV_AUTH_USER ??= "me";
}

const nextConfig: NextConfig = {
  // Standalone output → lets the Electron shell (P9/P10) bundle and run the server.
  output: "standalone",
  // Mongoose is a server-only native-ish package; don't let Next try to bundle it.
  // node-pty is a native module (interactive worktree shell) and ws backs the PTY
  // WebSocket server (started from instrumentation.ts) — keep both external so the
  // native .node loads from node_modules at runtime instead of being bundled.
  // @google-cloud/storage (canvas asset bytes) has dynamic requires + is server-only.
  serverExternalPackages: ["mongoose", "mongodb", "node-pty", "ws", "@google-cloud/storage"],
  // Pin the workspace root to this app (multiple lockfiles exist above us).
  outputFileTracingRoot: path.resolve(process.cwd()),
  // The mongodb driver lazily `require()`s optional native deps (aws4, kerberos,
  // snappy, …) inside try/catch — they are only needed for AWS IAM auth, Kerberos,
  // wire compression, etc., none of which we use. After the data-core extraction
  // the driver resolves from packages/data-core/node_modules, so serverExternalPackages
  // alone doesn't stop the bundler from statically tracing those requires and
  // emitting "Module not found" warnings. IgnorePlugin drops them at the resolve
  // step; mongodb's own try/catch then substitutes its graceful "optional module
  // not found" stub, so runtime behaviour is unchanged.
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(aws4|mongodb-client-encryption|kerberos|snappy|@mongodb-js\/zstd|@aws-sdk\/credential-providers|gcp-metadata|socks|aws-crt)$/,
      }),
    );
    return config;
  },
};

export default nextConfig;
