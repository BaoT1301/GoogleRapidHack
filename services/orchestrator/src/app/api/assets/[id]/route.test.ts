import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// Token-forwarding proxy unit tests. These exercise the BFF path only (BFF_URL
// set + global fetch mocked) -- the local-Mongo fallback path is covered by the
// existing assets.test.ts integration test, which boots a real Mongo connection.

const ORIG_BFF_URL = process.env.BFF_URL;
const BFF = "https://auth-bff-test.example/";

beforeEach(() => {
  process.env.BFF_URL = BFF;
});

afterEach(() => {
  if (ORIG_BFF_URL === undefined) delete process.env.BFF_URL;
  else process.env.BFF_URL = ORIG_BFF_URL;
  vi.restoreAllMocks();
});

function reqWithCookie(cookie: string | null): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost:3000/api/assets/01H123", { headers });
}

function reqWithBearer(token: string): Request {
  return new Request("http://localhost:3000/api/assets/01H123", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("/api/assets/[id] — BFF proxy mode", () => {
  it("returns 401 when no Bearer header and no __session cookie", async () => {
    const res = await GET(reqWithCookie(null), {
      params: Promise.resolve({ id: "01H123" }),
    });
    expect(res.status).toBe(401);
  });

  it("forwards the __session cookie as a Bearer token to the BFF", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array(png), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(png.length) },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      reqWithCookie("__session=clerk_session_jwt; other=ignored"),
      { params: Promise.resolve({ id: "01H123" }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://auth-bff-test.example/assets/01H123/bytes");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer clerk_session_jwt",
    );
  });

  it("prefers the Authorization Bearer header over the cookie", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([0x47, 0x49, 0x46, 0x38]), {
        status: 200,
        headers: { "content-type": "image/gif", "content-length": "4" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("http://localhost:3000/api/assets/01H123", {
      headers: {
        authorization: "Bearer header_wins",
        cookie: "__session=cookie_loses",
      },
    });
    await GET(req, { params: Promise.resolve({ id: "01H123" }) });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer header_wins",
    );
  });

  it("maps upstream 404 to 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );
    const res = await GET(reqWithBearer("t"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("maps upstream 401 to 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );
    const res = await GET(reqWithBearer("bad"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("maps upstream 5xx / network errors to a 502 (so the canvas falls back gracefully)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oh no", { status: 500 })),
    );
    const res = await GET(reqWithBearer("t"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(502);
  });
});
