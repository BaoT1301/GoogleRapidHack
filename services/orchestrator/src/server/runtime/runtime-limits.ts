export const DEFAULT_RUNTIME_LIMITS = {
  maxNodeRuntimeMs: 10 * 60_000,
  minNodeRuntimeMs: 1_000,
  maxAllowedNodeRuntimeMs: 60 * 60_000,
  terminateGraceMs: 10_000,
  maxStdoutBytes: 2 * 1024 * 1024,
  maxStderrBytes: 512 * 1024,
  maxCombinedOutputBytes: 3 * 1024 * 1024,
  outputLimitMode: "fail" as const,
  maxPatchPreviewBytes: 8 * 1024,
  maxEventPayloadBytes: 16 * 1024,
};

export type OutputLimitMode = "warn" | "fail";

export interface RuntimeLimitOptions {
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  maxCombinedOutputBytes?: number;
  outputLimitMode?: OutputLimitMode;
  maxPatchPreviewBytes?: number;
  maxEventPayloadBytes?: number;
  terminateGraceMs?: number;
}

export interface ResolvedRuntimeLimits {
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxCombinedOutputBytes: number;
  outputLimitMode: OutputLimitMode;
  maxPatchPreviewBytes: number;
  maxEventPayloadBytes: number;
  terminateGraceMs: number;
}

export function resolveRuntimeLimits(options: RuntimeLimitOptions = {}): ResolvedRuntimeLimits {
  return {
    timeoutMs: clampTimeout(options.timeoutMs),
    maxStdoutBytes: positiveOrDefault(options.maxStdoutBytes, DEFAULT_RUNTIME_LIMITS.maxStdoutBytes),
    maxStderrBytes: positiveOrDefault(options.maxStderrBytes, DEFAULT_RUNTIME_LIMITS.maxStderrBytes),
    maxCombinedOutputBytes: positiveOrDefault(
      options.maxCombinedOutputBytes,
      DEFAULT_RUNTIME_LIMITS.maxCombinedOutputBytes,
    ),
    outputLimitMode: options.outputLimitMode ?? DEFAULT_RUNTIME_LIMITS.outputLimitMode,
    maxPatchPreviewBytes: positiveOrDefault(
      options.maxPatchPreviewBytes,
      DEFAULT_RUNTIME_LIMITS.maxPatchPreviewBytes,
    ),
    maxEventPayloadBytes: positiveOrDefault(
      options.maxEventPayloadBytes,
      DEFAULT_RUNTIME_LIMITS.maxEventPayloadBytes,
    ),
    terminateGraceMs: positiveOrDefault(options.terminateGraceMs, DEFAULT_RUNTIME_LIMITS.terminateGraceMs),
  };
}

export function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return DEFAULT_RUNTIME_LIMITS.maxNodeRuntimeMs;
  }

  return Math.min(
    DEFAULT_RUNTIME_LIMITS.maxAllowedNodeRuntimeMs,
    Math.max(DEFAULT_RUNTIME_LIMITS.minNodeRuntimeMs, Math.trunc(value)),
  );
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }
  return Math.trunc(value);
}
