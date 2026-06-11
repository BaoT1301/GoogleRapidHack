/**
 * SEC-4 — Run-level circuit breaker (pure).
 *
 * Halts a run after N identical *consecutive* node failures so a thrashing or
 * mis-configured agent can never run the whole DAG into the ground repeating the
 * same error. A failure signature is `{ nodeKind, normalizedError }`; the breaker
 * trips only when the most recent `threshold` signatures are byte-identical after
 * normalization (mixed/distinct errors never trip it).
 *
 * Pure + defensive: no I/O, no throw, tolerant of empty/garbage input. The
 * run-executor records a signature as each node settles `failed` and skips the
 * remaining unstarted nodes once `shouldHalt` returns true (finalizing the run
 * `failed` with a clear reason via the EXISTING `run.failed` event — no new
 * event type, per the frozen SSE contract).
 */

/** Default consecutive-identical-failure count that trips the breaker. */
export const DEFAULT_BREAKER_THRESHOLD = 3;

export interface ErrorSignature {
  /** The node kind that failed (`execute` | `review` | `doc` | `loop` | …). */
  nodeKind: string;
  /** The raw error/reason text for the failure (normalized on comparison). */
  error: string;
}

/**
 * Normalize an error string so semantically-identical failures collapse to the
 * same key: lowercased, hashes/ids/numbers masked, whitespace collapsed, capped.
 * (So "timeout after 1000ms" and "timeout after 2000ms" are the same signature.)
 */
export function normalizeError(raw: string | undefined | null): string {
  if (raw === undefined || raw === null) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/g, "#") // long hex (hashes / ulids / sha)
    .replace(/\d+/g, "#") // bare numbers (ports, timeouts, line numbers)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Stable comparison key for a failure signature. */
export function signatureKey(signature: ErrorSignature): string {
  const kind = (signature?.nodeKind ?? "").toString().trim().toLowerCase() || "unknown";
  return `${kind}::${normalizeError(signature?.error)}`;
}

/**
 * True when the most recent `threshold` failure signatures are all identical.
 * `threshold <= 0` disables the breaker; fewer than `threshold` recorded
 * failures can never trip it.
 */
export function shouldHalt(
  signatures: ErrorSignature[],
  threshold: number = DEFAULT_BREAKER_THRESHOLD,
): boolean {
  if (!Array.isArray(signatures) || threshold <= 0) return false;
  if (signatures.length < threshold) return false;
  const recent = signatures.slice(-threshold).map(signatureKey);
  const first = recent[0];
  return recent.every((key) => key === first);
}

/**
 * Tiny stateful wrapper around the pure helpers for the run path: record each
 * failure, ask `tripped()`. Exposes the tripping signature for the run.failed
 * reason. Construction-only state — no shared/global mutation.
 */
export class CircuitBreaker {
  private readonly signatures: ErrorSignature[] = [];
  private trippedKey: string | null = null;

  constructor(private readonly threshold: number = DEFAULT_BREAKER_THRESHOLD) {}

  /** Record a settled-failed node; returns true if THIS failure trips the breaker. */
  record(signature: ErrorSignature): boolean {
    this.signatures.push(signature);
    if (this.trippedKey) return true;
    if (shouldHalt(this.signatures, this.threshold)) {
      this.trippedKey = signatureKey(signature);
      return true;
    }
    return false;
  }

  /** Whether the breaker has tripped. */
  get tripped(): boolean {
    return this.trippedKey !== null;
  }

  /** A human-readable reason for the EXISTING `run.failed` / `node.skipped` payloads. */
  reason(): string {
    return this.trippedKey
      ? `circuit breaker: ${this.threshold} consecutive identical failures (${this.trippedKey})`
      : "circuit breaker: not tripped";
  }
}
