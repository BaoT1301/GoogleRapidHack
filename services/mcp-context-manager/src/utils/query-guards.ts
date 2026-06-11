/**
 * Query Guards — Timeout wrapper and error types for query infrastructure.
 *
 * Provides:
 * - `QueryTimeoutError`: Custom error for timed-out queries
 * - `withTimeout<T>()`: Wraps an async function with a timeout guard and AbortController
 *
 * @module utils/query-guards
 */

/**
 * Custom error thrown when a query exceeds its timeout.
 */
export class QueryTimeoutError extends Error {
  public readonly code = "TIMEOUT" as const;
  public readonly retryable = true;
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Query timed out after ${timeoutMs}ms`);
    this.name = "QueryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Custom error for invalid query parameters.
 */
export class InvalidParamsError extends Error {
  public readonly code = "INVALID_PARAMS" as const;
  public readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "InvalidParamsError";
  }
}

/**
 * Custom error when a queried resource is not found.
 */
export class NotFoundError extends Error {
  public readonly code = "NOT_FOUND" as const;
  public readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Standard error response schema for all new query endpoints.
 */
export interface QueryErrorResponse {
  error: string;
  code: "TIMEOUT" | "INVALID_PARAMS" | "NOT_FOUND";
  retryable: boolean;
}

/**
 * Wraps an async function with a timeout guard.
 *
 * Creates an `AbortController` and passes its `signal` to the provided function.
 * If the function does not resolve within `ms` milliseconds, the signal is aborted
 * and a `QueryTimeoutError` is thrown.
 *
 * @param fn - Async function that accepts an `AbortSignal` for cooperative cancellation.
 * @param ms - Timeout in milliseconds. Default: 5000.
 * @returns The resolved value of `fn`.
 * @throws {QueryTimeoutError} If `fn` does not complete within `ms` milliseconds.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number = 5000,
): Promise<T> {
  const controller = new AbortController();
  const { signal } = controller;

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new QueryTimeoutError(ms));
    }, ms);
  });

  try {
    const result = await Promise.race([fn(signal), timeoutPromise]);
    return result;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Applies pagination (limit/offset) to an array of results.
 *
 * @param items - The full result array.
 * @param limit - Maximum number of items to return. Default: 100. Max: 1000.
 * @param offset - Number of items to skip. Default: 0.
 * @returns Paginated slice of the array.
 */
export function paginate<T>(items: T[], limit: number = 100, offset: number = 0): T[] {
  const clampedLimit = Math.min(Math.max(1, limit), 1000);
  const clampedOffset = Math.max(0, offset);
  return items.slice(clampedOffset, clampedOffset + clampedLimit);
}

/**
 * Parses pagination parameters from URL search params or request body.
 *
 * @param params - Object with optional `limit` and `offset` values.
 * @returns Parsed and clamped pagination values.
 */
export function parsePaginationParams(params: {
  limit?: string | number | null;
  offset?: string | number | null;
}): { limit: number; offset: number } {
  const rawLimit = typeof params.limit === "string" ? parseInt(params.limit, 10) : (params.limit ?? 100);
  const rawOffset = typeof params.offset === "string" ? parseInt(params.offset, 10) : (params.offset ?? 0);

  return {
    limit: Math.min(Math.max(1, Number.isNaN(rawLimit) ? 100 : rawLimit), 1000),
    offset: Math.max(0, Number.isNaN(rawOffset) ? 0 : rawOffset),
  };
}

/**
 * Builds a standard error response object.
 */
export function buildErrorResponse(error: unknown): QueryErrorResponse {
  if (error instanceof QueryTimeoutError) {
    return { error: error.message, code: "TIMEOUT", retryable: true };
  }
  if (error instanceof InvalidParamsError) {
    return { error: error.message, code: "INVALID_PARAMS", retryable: false };
  }
  if (error instanceof NotFoundError) {
    return { error: error.message, code: "NOT_FOUND", retryable: false };
  }
  return { error: "Internal server error", code: "NOT_FOUND", retryable: false };
}

/**
 * Returns the appropriate HTTP status code for a query error.
 */
export function errorStatusCode(error: unknown): number {
  if (error instanceof QueryTimeoutError) return 504;
  if (error instanceof InvalidParamsError) return 400;
  if (error instanceof NotFoundError) return 404;
  return 500;
}

/**
 * Retry wrapper for query handlers. Retries on `QueryTimeoutError` up to
 * `maxRetries` times with `backoffMs` delay between attempts.
 *
 * @param fn - The async handler to retry.
 * @param maxRetries - Maximum number of retries. Default: 2.
 * @param backoffMs - Delay between retries in milliseconds. Default: 500.
 * @returns The resolved value of `fn`.
 * @throws The last error if all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  backoffMs: number = 500,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof QueryTimeoutError && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
