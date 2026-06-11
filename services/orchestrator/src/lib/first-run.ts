// Client-side first-run flags. SSR-guarded so server components/tests don't touch
// a non-existent `window`. NOTE (AD-8): the passphrase + API key VALUES are never
// stored here — keys go to the encrypted vault via `trpc.secrets.create`, and the
// passphrase arrives via Electron `safeStorage` (Phase 6.6). Only non-secret flags
// and the default repo path live in localStorage.

const SETUP_KEY = "orchestrator.setup.completed";
const REPO_KEY = "orchestrator.setup.defaultRepoPath";

export function isSetupComplete(): boolean {
  if (typeof window === "undefined") return true; // never auto-open on the server
  return window.localStorage.getItem(SETUP_KEY) === "1";
}

export function markSetupComplete(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETUP_KEY, "1");
}

export function saveDefaultRepoPath(path: string): void {
  if (typeof window === "undefined") return;
  if (path.trim()) window.localStorage.setItem(REPO_KEY, path.trim());
}

export function getDefaultRepoPath(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(REPO_KEY) ?? "";
}
