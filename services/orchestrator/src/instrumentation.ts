// Next.js instrumentation hook. Runs once when the server process boots (dev,
// `next start`, and the standalone server the Electron shell launches). We use it
// to start the dedicated PTY WebSocket server that backs the interactive worktree
// shell — Next route handlers can't perform a WS upgrade themselves.
//
// The node-only server graph (node-pty / ws / mongoose / fs) is imported ONLY
// inside the `NEXT_RUNTIME === "nodejs"` branch. Next replaces NEXT_RUNTIME with
// a build-time literal, so this whole import is dead-code-eliminated from the
// edge (middleware) instrumentation bundle and never compiled there.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Opt-out for environments that shouldn't expose a shell (e.g. a hosted
    // multi-tenant deploy). Defaults ON for the local desktop app.
    if (process.env.ORCH_DISABLE_PTY_SHELL === "1") return;
    try {
      const { startPtyWsServer } = await import("./server/runtime/pty-ws-server");
      await startPtyWsServer();
    } catch (err) {
      // Never let a shell-server failure crash the whole app boot.
      console.error(
        "[instrumentation] failed to start PTY ws server:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
