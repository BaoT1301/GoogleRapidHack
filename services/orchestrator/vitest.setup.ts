import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// Some browser-oriented deps (e.g. @xterm/addon-fit's UMD shim) reference the
// `self` global at module-load time. In the node test environment that global is
// absent and throws a ReferenceError when such a module is imported transitively.
// Alias it to globalThis (no-op in jsdom, which already defines `self`).
(globalThis as { self?: unknown }).self ??= globalThis;

// Unmount React trees between component tests. Guarded so node-env (server/DB)
// test files, which share this setup, don't touch a non-existent DOM.
afterEach(async () => {
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
