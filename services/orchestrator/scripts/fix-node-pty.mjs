// node-pty ships its prebuilt `spawn-helper` (macOS/Linux) without the execute
// bit set in some npm/extract paths, causing `posix_spawnp failed` at runtime.
// Restore +x after install (and after the standalone copy). No-op on Windows and
// when node-pty isn't installed. Best-effort: never fails the install.
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32") {
  try {
    const prebuilds = join(process.cwd(), "node_modules", "node-pty", "prebuilds");
    if (existsSync(prebuilds)) {
      for (const dir of readdirSync(prebuilds)) {
        const helper = join(prebuilds, dir, "spawn-helper");
        if (existsSync(helper) && statSync(helper).isFile()) {
          chmodSync(helper, 0o755);
          console.log(`[node-pty] chmod +x ${helper}`);
        }
      }
    }
  } catch (err) {
    console.warn(
      "[node-pty] could not fix spawn-helper perms:",
      err instanceof Error ? err.message : err,
    );
  }
}
