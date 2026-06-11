import { describe, expect, it, vi } from "vitest";
import {
  createPtyConnectionHandler,
  isLocalhostOrigin,
  parsePtyTarget,
  resolvePtyWsPort,
  type PtyRequestLike,
  type WsLike,
} from "./pty-ws-server";

// A fake socket capturing sent frames + close, and letting tests drive messages.
class FakeSocket implements WsLike {
  sent: string[] = [];
  closed?: { code?: number; reason?: string };
  private handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  on(event: "message" | "close" | "error", cb: (...a: unknown[]) => void) {
    (this.handlers[event] ??= []).push(cb);
  }
  emit(event: string, ...args: unknown[]) {
    for (const cb of this.handlers[event] ?? []) cb(...args);
  }
  parsedFrames() {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function fakeManager() {
  return {
    create: vi.fn().mockResolvedValue({ pid: 1 }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn().mockReturnValue(true),
  };
}

const req = (url: string, headers: Record<string, string> = {}): PtyRequestLike => ({
  url,
  headers: { origin: "http://localhost:3000", ...headers },
});

const goodDeps = (manager: ReturnType<typeof fakeManager>) => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manager: manager as any,
  authorize: vi.fn().mockResolvedValue("user_1"),
  resolveWorktree: vi.fn().mockResolvedValue("/wt/n1"),
  genId: () => "sess1",
});

describe("parsePtyTarget", () => {
  it("parses runId + nodeId", () => {
    expect(parsePtyTarget("/pty?runId=r1&nodeId=n1")).toEqual({ runId: "r1", nodeId: "n1" });
  });
  it("rejects wrong path or missing params", () => {
    expect(parsePtyTarget("/nope?runId=r1&nodeId=n1")).toBeNull();
    expect(parsePtyTarget("/pty?runId=r1")).toBeNull();
    expect(parsePtyTarget(undefined)).toBeNull();
  });
});

describe("isLocalhostOrigin", () => {
  it("allows loopback + absent origin, rejects remote", () => {
    expect(isLocalhostOrigin("http://localhost:3000")).toBe(true);
    expect(isLocalhostOrigin("http://127.0.0.1:9")).toBe(true);
    expect(isLocalhostOrigin(undefined)).toBe(true);
    expect(isLocalhostOrigin("https://evil.example.com")).toBe(false);
  });
});

describe("resolvePtyWsPort", () => {
  it("defaults to 3031", () => {
    const prev = process.env.ORCH_PTY_WS_PORT;
    delete process.env.ORCH_PTY_WS_PORT;
    expect(resolvePtyWsPort()).toBe(3031);
    if (prev) process.env.ORCH_PTY_WS_PORT = prev;
  });
});

describe("createPtyConnectionHandler — security flow", () => {
  it("rejects a remote origin with 4403", async () => {
    const manager = fakeManager();
    const handler = createPtyConnectionHandler(goodDeps(manager));
    const sock = new FakeSocket();
    await handler(sock, req("/pty?runId=r1&nodeId=n1", { origin: "https://evil.com" }));
    expect(sock.closed?.code).toBe(4403);
    expect(manager.create).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated connection with 4401", async () => {
    const manager = fakeManager();
    const deps = { ...goodDeps(manager), authorize: vi.fn().mockResolvedValue(null) };
    const handler = createPtyConnectionHandler(deps);
    const sock = new FakeSocket();
    await handler(sock, req("/pty?runId=r1&nodeId=n1"));
    expect(sock.closed?.code).toBe(4401);
    expect(manager.create).not.toHaveBeenCalled();
  });

  it("rejects when the owner has no worktree for the node with 4404", async () => {
    const manager = fakeManager();
    const deps = { ...goodDeps(manager), resolveWorktree: vi.fn().mockResolvedValue(null) };
    const handler = createPtyConnectionHandler(deps);
    const sock = new FakeSocket();
    await handler(sock, req("/pty?runId=r1&nodeId=n1"));
    expect(sock.closed?.code).toBe(4404);
  });

  it("bridges init/data/resize to the PTY and kills on close", async () => {
    const manager = fakeManager();
    const handler = createPtyConnectionHandler(goodDeps(manager));
    const sock = new FakeSocket();
    await handler(sock, req("/pty?runId=r1&nodeId=n1"));

    sock.emit("message", JSON.stringify({ type: "init", cols: 100, rows: 30 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.create).toHaveBeenCalledTimes(1);
    expect(manager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess1",
        runId: "r1",
        nodeId: "n1",
        cwd: "/wt/n1",
        cols: 100,
        rows: 30,
      }),
    );

    sock.emit("message", JSON.stringify({ type: "data", data: "ls\r" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.write).toHaveBeenCalledWith("sess1", "ls\r");

    sock.emit("message", JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.resize).toHaveBeenCalledWith("sess1", 120, 40);

    sock.emit("close");
    expect(manager.kill).toHaveBeenCalledWith("sess1");
  });

  it("streams PTY output back to the socket as data frames", async () => {
    const manager = fakeManager();
    let captured: ((data: string) => void) | undefined;
    manager.create.mockImplementation(async (input: { onData: (d: string) => void }) => {
      captured = input.onData;
      return { pid: 1 };
    });
    const handler = createPtyConnectionHandler(goodDeps(manager));
    const sock = new FakeSocket();
    await handler(sock, req("/pty?runId=r1&nodeId=n1"));

    sock.emit("message", JSON.stringify({ type: "init", cols: 80, rows: 24 }));
    await Promise.resolve();
    await Promise.resolve();
    captured?.("\x1b[32mok\x1b[0m");
    expect(sock.parsedFrames()).toContainEqual({ type: "data", data: "\x1b[32mok\x1b[0m" });
  });
});
