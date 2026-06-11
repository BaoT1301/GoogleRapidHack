import { describe, it, expect } from "vitest";
import {
  QueryTimeoutError,
  InvalidParamsError,
  NotFoundError,
  withTimeout,
  withRetry,
  paginate,
  parsePaginationParams,
  buildErrorResponse,
  errorStatusCode,
} from "../utils/query-guards.js";

describe("QueryTimeoutError", () => {
  it("has correct properties", () => {
    const err = new QueryTimeoutError(3000);
    expect(err.name).toBe("QueryTimeoutError");
    expect(err.code).toBe("TIMEOUT");
    expect(err.retryable).toBe(true);
    expect(err.timeoutMs).toBe(3000);
    expect(err.message).toBe("Query timed out after 3000ms");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("withTimeout", () => {
  it("resolves normally when function completes within timeout", async () => {
    const result = await withTimeout(async (_signal) => {
      return "success";
    }, 1000);

    expect(result).toBe("success");
  });

  it("passes AbortSignal to the function", async () => {
    let receivedSignal: AbortSignal | null = null;

    await withTimeout(async (signal) => {
      receivedSignal = signal;
      return "done";
    }, 1000);

    expect(receivedSignal).not.toBeNull();
    expect(receivedSignal!.aborted).toBe(false);
  });

  it("rejects with QueryTimeoutError when function exceeds timeout", async () => {
    await expect(
      withTimeout(async (_signal) => {
        // Simulate a slow operation
        await new Promise((resolve) => setTimeout(resolve, 500));
        return "too late";
      }, 50),
    ).rejects.toThrow(QueryTimeoutError);
  });

  it("aborts the signal when timeout fires", async () => {
    let signalAborted = false;

    try {
      await withTimeout(async (signal) => {
        signal.addEventListener("abort", () => {
          signalAborted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        return "too late";
      }, 50);
    } catch {
      // Expected
    }

    expect(signalAborted).toBe(true);
  });

  it("uses default timeout of 5000ms", async () => {
    // This should complete well within 5000ms
    const result = await withTimeout(async () => "fast");
    expect(result).toBe("fast");
  });

  it("cleans up timer on successful completion", async () => {
    // If the timer isn't cleaned up, this would leak. We verify by running
    // many iterations without hanging.
    for (let i = 0; i < 10; i++) {
      await withTimeout(async () => i, 1000);
    }
  });

  it("supports cooperative cancellation via signal check", async () => {
    let iterations = 0;

    try {
      await withTimeout(async (signal) => {
        while (!signal.aborted) {
          iterations++;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return iterations;
      }, 50);
    } catch {
      // Expected timeout
    }

    // Should have done some iterations but not infinite
    expect(iterations).toBeGreaterThan(0);
    expect(iterations).toBeLessThan(100);
  });
});

describe("withRetry", () => {
  it("returns result on first success", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(1);
  });

  it("retries on QueryTimeoutError and succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new QueryTimeoutError(5000);
        }
        return "recovered";
      },
      2,
      10, // Short backoff for test speed
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("throws after exhausting all retries", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new QueryTimeoutError(5000);
        },
        2,
        10,
      ),
    ).rejects.toThrow(QueryTimeoutError);

    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it("does not retry non-timeout errors", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("not a timeout");
        },
        2,
        10,
      ),
    ).rejects.toThrow("not a timeout");

    expect(attempts).toBe(1); // No retries for non-timeout errors
  });
});

describe("paginate", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns first page with default params", () => {
    expect(paginate(items)).toEqual(items);
  });

  it("applies limit", () => {
    expect(paginate(items, 3)).toEqual([1, 2, 3]);
  });

  it("applies offset", () => {
    expect(paginate(items, 3, 2)).toEqual([3, 4, 5]);
  });

  it("clamps limit to max 1000", () => {
    expect(paginate(items, 5000)).toEqual(items);
  });

  it("clamps limit to min 1", () => {
    expect(paginate(items, 0)).toEqual([1]);
    expect(paginate(items, -5)).toEqual([1]);
  });

  it("clamps offset to min 0", () => {
    expect(paginate(items, 3, -1)).toEqual([1, 2, 3]);
  });

  it("returns empty array when offset exceeds length", () => {
    expect(paginate(items, 3, 100)).toEqual([]);
  });
});

describe("parsePaginationParams", () => {
  it("parses string values", () => {
    expect(parsePaginationParams({ limit: "50", offset: "10" })).toEqual({
      limit: 50,
      offset: 10,
    });
  });

  it("parses number values", () => {
    expect(parsePaginationParams({ limit: 50, offset: 10 })).toEqual({
      limit: 50,
      offset: 10,
    });
  });

  it("uses defaults for missing values", () => {
    expect(parsePaginationParams({})).toEqual({ limit: 100, offset: 0 });
  });

  it("uses defaults for null values", () => {
    expect(parsePaginationParams({ limit: null, offset: null })).toEqual({
      limit: 100,
      offset: 0,
    });
  });

  it("clamps limit to [1, 1000]", () => {
    expect(parsePaginationParams({ limit: "0" })).toEqual({ limit: 1, offset: 0 });
    expect(parsePaginationParams({ limit: "2000" })).toEqual({ limit: 1000, offset: 0 });
  });

  it("handles NaN gracefully", () => {
    expect(parsePaginationParams({ limit: "abc", offset: "xyz" })).toEqual({
      limit: 100,
      offset: 0,
    });
  });
});

describe("buildErrorResponse", () => {
  it("builds response for QueryTimeoutError", () => {
    const resp = buildErrorResponse(new QueryTimeoutError(5000));
    expect(resp).toEqual({
      error: "Query timed out after 5000ms",
      code: "TIMEOUT",
      retryable: true,
    });
  });

  it("builds response for InvalidParamsError", () => {
    const resp = buildErrorResponse(new InvalidParamsError("bad param"));
    expect(resp).toEqual({
      error: "bad param",
      code: "INVALID_PARAMS",
      retryable: false,
    });
  });

  it("builds response for NotFoundError", () => {
    const resp = buildErrorResponse(new NotFoundError("not found"));
    expect(resp).toEqual({
      error: "not found",
      code: "NOT_FOUND",
      retryable: false,
    });
  });

  it("builds generic response for unknown errors", () => {
    const resp = buildErrorResponse(new Error("unknown"));
    expect(resp.error).toBe("Internal server error");
    expect(resp.retryable).toBe(false);
  });
});

describe("errorStatusCode", () => {
  it("returns 504 for QueryTimeoutError", () => {
    expect(errorStatusCode(new QueryTimeoutError(5000))).toBe(504);
  });

  it("returns 400 for InvalidParamsError", () => {
    expect(errorStatusCode(new InvalidParamsError("bad"))).toBe(400);
  });

  it("returns 404 for NotFoundError", () => {
    expect(errorStatusCode(new NotFoundError("missing"))).toBe(404);
  });

  it("returns 500 for unknown errors", () => {
    expect(errorStatusCode(new Error("boom"))).toBe(500);
  });
});
