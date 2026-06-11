import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMcpManager, type McpManagerDeps, type McpProcHandle } from "./managed-mcp";

function fakeHandle(): McpProcHandle & { killed: boolean } {
  let dead = false;
  const h = {
    killed: false,
    kill: () => {
      h.killed = true;
      dead = true;
    },
    onExit: (_cb: () => void) => {},
    exited: () => dead,
  };
  return h;
}

const never = () => new Promise<void>(() => {});
const immediate = () => Promise.resolve();

function deps(over: Partial<McpManagerDeps> = {}): McpManagerDeps {
  return {
    resolveEntry: () => "/mcp/dist/server.js",
    spawn: () => fakeHandle(),
    findFreePort: async () => 3001,
    waitReady: async () => true,
    delay: never,
    ...over,
  };
}

beforeEach(() => {
  delete process.env.ORCH_MCP_AUTOSPAWN;
});

describe("createMcpManager", () => {
  it("returns undefined and does not spawn when disabled", async () => {
    process.env.ORCH_MCP_AUTOSPAWN = "false";
    const spawn = vi.fn(() => fakeHandle());
    const m = createMcpManager(deps({ spawn }));
    expect(await m.ensure("/repo")).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns undefined and does not spawn when mcp entry is missing", async () => {
    const spawn = vi.fn(() => fakeHandle());
    const m = createMcpManager(deps({ resolveEntry: () => undefined, spawn }));
    expect(await m.ensure("/repo")).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns once and reuses the instance for the same repo", async () => {
    const spawn = vi.fn(() => fakeHandle());
    const m = createMcpManager(deps({ spawn }));
    const a = await m.ensure("/repo");
    const b = await m.ensure("/repo");
    expect(a).toBe("http://localhost:3001");
    expect(b).toBe("http://localhost:3001");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(m.size()).toBe(1);
  });

  it("passes WORKSPACE_ROOT + HTTP_PORT to the spawned process", async () => {
    let env: Record<string, string> = {};
    const spawn = vi.fn((_e: string, e: Record<string, string>) => {
      env = e;
      return fakeHandle();
    });
    const m = createMcpManager(deps({ spawn, findFreePort: async () => 4321 }));
    await m.ensure("/some/repo");
    expect(env.HTTP_PORT).toBe("4321");
    expect(env.WORKSPACE_ROOT).toMatch(/repo/);
  });

  it("returns the url when ready within the wait window", async () => {
    const m = createMcpManager(deps({ waitReady: async () => true, delay: never }));
    expect(await m.ensure("/repo")).toBe("http://localhost:3001");
  });

  it("falls back to undefined but keeps the instance warming when not ready in time", async () => {
    const m = createMcpManager(deps({ waitReady: () => new Promise(() => {}), delay: immediate }));
    expect(await m.ensure("/repo")).toBeUndefined();
    expect(m.size()).toBe(1); // still warming → next sync can use it
  });

  it("keeps a separate instance per repo path", async () => {
    const spawn = vi.fn(() => fakeHandle());
    const m = createMcpManager(deps({ spawn }));
    await m.ensure("/repo-a");
    await m.ensure("/repo-b");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(m.size()).toBe(2);
  });

  it("respawns after the instance has exited", async () => {
    const handles: ReturnType<typeof fakeHandle>[] = [];
    const spawn = vi.fn(() => {
      const h = fakeHandle();
      handles.push(h);
      return h;
    });
    const m = createMcpManager(deps({ spawn }));
    await m.ensure("/repo");
    handles[0].kill(); // simulate the process dying
    await m.ensure("/repo");
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("shutdown kills all instances", async () => {
    const handles: ReturnType<typeof fakeHandle>[] = [];
    const spawn = vi.fn(() => {
      const h = fakeHandle();
      handles.push(h);
      return h;
    });
    const m = createMcpManager(deps({ spawn }));
    await m.ensure("/repo-a");
    await m.ensure("/repo-b");
    m.shutdown();
    expect(handles.every((h) => h.killed)).toBe(true);
    expect(m.size()).toBe(0);
  });
});
