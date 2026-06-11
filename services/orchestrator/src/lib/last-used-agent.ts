const AGENT_KEY = "orchestrator:lastUsedAgent";
const MODEL_KEY = "orchestrator:lastUsedModelByProvider";

const VALID_AGENTS = ["claude", "codex", "gemini", "kiro"] as const;
export type LastUsedAgent = (typeof VALID_AGENTS)[number];

const isClient = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export function getLastUsedAgent(): LastUsedAgent | null {
  if (!isClient) return null;
  const val = window.localStorage.getItem(AGENT_KEY);
  if (val && (VALID_AGENTS as readonly string[]).includes(val)) {
    return val as LastUsedAgent;
  }
  return null;
}

export function saveLastUsedAgent(agent: string): void {
  if (!isClient) return;
  if ((VALID_AGENTS as readonly string[]).includes(agent)) {
    window.localStorage.setItem(AGENT_KEY, agent);
  }
}

export function getLastUsedModel(provider: string): string | null {
  if (!isClient) return null;
  try {
    const raw = window.localStorage.getItem(MODEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed[provider] === "string") {
      return parsed[provider];
    }
  } catch {
    // Ignore errors
  }
  return null;
}

export function saveLastUsedModel(provider: string, model: string): void {
  if (!isClient) return;
  try {
    const raw = window.localStorage.getItem(MODEL_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const map = parsed && typeof parsed === "object" ? parsed : {};
    map[provider] = model;
    window.localStorage.setItem(MODEL_KEY, JSON.stringify(map));
  } catch {
    // Ignore errors
  }
}
