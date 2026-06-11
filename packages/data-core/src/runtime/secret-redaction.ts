/**
 * Secret redaction core (shared data-core) — the process-wide registry + pattern
 * backstop that scrubs credentials from any streamed/persisted event payload (SEC-2).
 * Lives here because the Mongo run gateway redacts at the persistence seam, and both
 * the orchestrator and the auth-bff service need it. Pure (no orchestrator deps).
 *
 * The orchestrator's runtime adds `subprocessKeyEnv` (which needs a CLI-auth type) on
 * top and re-exports these.
 */
const MASK = "***";
// Only mask values long enough to be a real credential (avoids masking "" or short tokens).
const MIN_SECRET_LEN = 8;

// Process-wide registry of known secret values to scrub from any streamed/persisted
// event payload (partial SEC-2). Seeded from the env at module load.
const secrets = new Set<string>();

export function registerSecret(value?: string | null): void {
  if (typeof value === "string" && value.length >= MIN_SECRET_LEN) secrets.add(value);
}

// Seed known credential env vars so they can never leak even if echoed by a CLI.
for (const v of [process.env.KIRO_API_KEY, process.env.ANTHROPIC_API_KEY, process.env.OPENAI_API_KEY]) {
  registerSecret(v);
}

/**
 * SEC-2 pattern backstop: conservative, bounded regexes for obvious credential
 * shapes, applied ALONGSIDE the exact-value registry so a key the orchestrator
 * never saw (e.g. echoed by a CLI it spawned) is still masked. Deliberately
 * narrow + length-bounded to avoid over-masking legitimate output.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic-style API keys
  /gh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub tokens (ghp_/gho_/ghu_/ghs_/ghr_)
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
];

/**
 * Replace every registered secret value AND any obvious credential pattern
 * inside a payload with `***`. Returns the SAME reference when nothing changed
 * (so a redaction-free payload is never needlessly re-serialized).
 */
export function redactSecrets<T>(payload: T): T {
  const values = [...secrets];
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    return payload;
  }
  if (json === undefined) return payload; // non-serializable (e.g. a bare function)
  let redacted = json;
  for (const secret of values) redacted = redacted.split(secret).join(MASK);
  for (const re of SECRET_PATTERNS) redacted = redacted.replace(re, MASK);
  return redacted === json ? payload : (JSON.parse(redacted) as T);
}

/** Test-only: reset the registry between cases. */
export function __resetSecretsForTest(): void {
  secrets.clear();
}
