// next build (output: "standalone") does NOT copy static assets into the
// standalone bundle. Copy them so `.next/standalone/server.js` can serve the app.
import { cp, mkdir, chmod, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const tasks = [
  [".next/static", ".next/standalone/.next/static"],
  ["scripts/fake-agent.js", ".next/standalone/scripts/fake-agent.js"],
];
if (existsSync("public")) tasks.push(["public", ".next/standalone/public"]);

// node-pty is `serverExternalPackages` (native, not bundled). Next's file tracing
// can miss its prebuilt binaries (loaded via runtime path resolution), so copy the
// whole package into the standalone node_modules and restore the spawn-helper +x.
if (existsSync("node_modules/node-pty")) {
  tasks.push(["node_modules/node-pty", ".next/standalone/node_modules/node-pty"]);
}

for (const [src, dest] of tasks) {
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log(`[standalone] copied ${src} -> ${dest}`);
}

// Restore +x on the copied node-pty spawn-helper (cp can drop the bit).
const ptyPrebuilds = ".next/standalone/node_modules/node-pty/prebuilds";
if (process.platform !== "win32" && existsSync(ptyPrebuilds)) {
  for (const dir of await readdir(ptyPrebuilds)) {
    const helper = `${ptyPrebuilds}/${dir}/spawn-helper`;
    try {
      if ((await stat(helper)).isFile()) {
        await chmod(helper, 0o755);
        console.log(`[standalone] chmod +x ${helper}`);
      }
    } catch {
      /* helper absent for this platform */
    }
  }
}
