/**
 * MODEL-2 — sandboxed `{{upstream.<nodeId>.<dotpath>}}` data-binding resolution.
 *
 * A `data` edge (`IEdgeSpec.kind: "data"`) declares that a downstream node's
 * prompt may reference an upstream node's parsed output
 * (`ExecuteRunnerSummary.output`, the `<!-- orch:output -->` JSON). This module
 * substitutes those references into a template string.
 *
 * SANDBOXED by construction — there is NO code execution here:
 *   - the ONLY supported syntax is `{{upstream.<nodeId>.<dotpath>}}` over a plain
 *     object map (no Handlebars helpers, no expressions, no `eval`);
 *   - prototype-polluting key paths (`__proto__` / `constructor` / `prototype`)
 *     are REJECTED — never traversed;
 *   - traversal only walks own enumerable properties / array indices of plain
 *     objects (inherited/prototype members are invisible);
 *   - output is bounded (per-substitution + total caps) so a huge upstream blob
 *     can never blow up the spawned CLI's prompt;
 *   - it NEVER throws (a malformed template/value degrades to leaving the
 *     placeholder unresolved).
 *
 * Resolution policy for a `{{upstream.<id>.<path>}}` placeholder:
 *   - upstream `<id>` NOT present in the map  → leave the placeholder UNTOUCHED
 *     (the upstream hasn't produced output / isn't connected yet) + report it.
 *   - `<id>` present but `<path>` doesn't resolve (missing field / forbidden key)
 *     → replace with a clearly-marked `[unresolved: upstream.<id>.<path>]` + report.
 *   - resolves → substitute the stringified, size-capped value.
 */

/** Per-substitution char cap — one upstream value can't dominate the prompt. */
const MAX_VALUE_CHARS = 4000;
/** Total resolved-output char cap. */
const MAX_OUTPUT_CHARS = 16000;

/** Keys that must never be traversed (prototype pollution defense). */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// `{{ upstream.<nodeId>.<dotpath> }}` — nodeId has no dot/space/brace; the path
// is everything up to the closing braces (dots allowed). Whitespace-tolerant.
const PLACEHOLDER = /\{\{\s*upstream\.([^.}\s]+)\.([^}]+?)\s*\}\}/g;

export interface DataBindingResolution {
  /** The template with every resolvable binding substituted. */
  text: string;
  /** The raw placeholder tokens that could NOT be resolved (for preview/dry-run). */
  unresolved: string[];
}

/** Trim + hard-cap a string (adds a truncation marker when clipped). */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated]`;
}

/** Stringify a resolved value for prompt insertion (objects → compact JSON). */
function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Walk a dot-path over a plain object/array. Returns `undefined` when any
 * segment is missing, hits a non-traversable value, or is a forbidden key.
 * Only own properties / valid array indices are followed.
 */
function getByPath(root: unknown, segments: string[]): unknown {
  let cur: unknown = root;
  for (const seg of segments) {
    if (FORBIDDEN_KEYS.has(seg)) return undefined;
    if (cur === null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Resolve `{{upstream.<id>.<path>}}` bindings in `template` from a map of
 * upstream node outputs (keyed by upstream nodeId). Pure, bounded, never throws.
 */
export function resolveDataBindings(
  template: string,
  upstreamOutputsByNodeId: Record<string, unknown>,
): DataBindingResolution {
  if (typeof template !== "string" || template.length === 0) {
    return { text: typeof template === "string" ? template : "", unresolved: [] };
  }
  const map = upstreamOutputsByNodeId ?? {};
  const unresolved: string[] = [];

  let out: string;
  try {
    out = template.replace(PLACEHOLDER, (match, nodeId: string, rawPath: string) => {
      const segments = rawPath
        .split(".")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Reject prototype-polluting / empty paths — never traverse.
      if (segments.length === 0 || segments.some((s) => FORBIDDEN_KEYS.has(s))) {
        unresolved.push(match);
        return `[unresolved: upstream.${nodeId}.${rawPath.trim()}]`;
      }

      // Upstream not in the map → leave untouched (not yet produced / not wired).
      if (!Object.prototype.hasOwnProperty.call(map, nodeId)) {
        unresolved.push(match);
        return match;
      }

      const value = getByPath(map[nodeId], segments);
      if (value === undefined) {
        unresolved.push(match);
        return `[unresolved: upstream.${nodeId}.${segments.join(".")}]`;
      }
      return clip(stringifyValue(value), MAX_VALUE_CHARS);
    });
  } catch {
    return { text: template, unresolved };
  }

  return { text: clip(out, MAX_OUTPUT_CHARS), unresolved };
}
