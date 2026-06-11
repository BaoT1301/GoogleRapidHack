import { describe, expect, it } from "vitest";
import {
  MCP_CONTEXT_MANAGER_CONTAINER,
  probeMcpContextManager,
  resolveMcpContextManagerMode,
} from "./mcp-context-reachability";

const dockerEnv = {} as NodeJS.ProcessEnv;
const nodeEnv = {
  MCP_CONTEXT_MANAGER_MODE: "node",
  MCP_CONTEXT_MANAGER_PATH: "/app/services/mcp-context-manager/dist/server.js",
} as unknown as NodeJS.ProcessEnv;

describe("resolveMcpContextManagerMode", () => {
  it("defaults to docker; switches to node only on explicit flag", () => {
    expect(resolveMcpContextManagerMode({} as NodeJS.ProcessEnv)).toBe("docker");
    expect(
      resolveMcpContextManagerMode({ MCP_CONTEXT_MANAGER_MODE: "node" } as unknown as NodeJS.ProcessEnv),
    ).toBe("node");
    expect(
      resolveMcpContextManagerMode({ MCP_CONTEXT_MANAGER_MODE: "weird" } as unknown as NodeJS.ProcessEnv),
    ).toBe("docker");
  });
});

describe("probeMcpContextManager — docker (dev) mode", () => {
  it("is reachable when the container is running, and reports the docker-exec command", async () => {
    const seen: string[] = [];
    const r = await probeMcpContextManager({
      env: dockerEnv,
      dockerContainerRunning: async (c) => {
        seen.push(c);
        return true;
      },
    });
    expect(r.mode).toBe("docker");
    expect(r.command).toBe("docker");
    expect(r.args).toEqual(
      expect.arrayContaining(["exec", "-i", MCP_CONTEXT_MANAGER_CONTAINER, "--stdio-only"]),
    );
    expect(r.reachable).toBe(true);
    expect(seen).toEqual([MCP_CONTEXT_MANAGER_CONTAINER]);
  });

  it("is unreachable with an actionable fix when the container is down", async () => {
    const r = await probeMcpContextManager({
      env: dockerEnv,
      dockerContainerRunning: async () => false,
    });
    expect(r.reachable).toBe(false);
    expect(r.reason).toMatch(/not running/i);
    expect(r.suggestedFix).toMatch(/mcp\.sh up/i);
  });
});

describe("probeMcpContextManager — node (packaged) mode", () => {
  it("is reachable when the bundled server path exists, reporting the node command", async () => {
    const checked: string[] = [];
    const r = await probeMcpContextManager({
      env: nodeEnv,
      fileExists: async (p) => {
        checked.push(p);
        return true;
      },
    });
    expect(r.mode).toBe("node");
    expect(r.command).toBe("node");
    expect(r.args[0]).toBe("/app/services/mcp-context-manager/dist/server.js");
    expect(r.args).toContain("--stdio-only");
    expect(r.reachable).toBe(true);
    expect(checked).toEqual(["/app/services/mcp-context-manager/dist/server.js"]);
  });

  it("is unreachable with a PKG-3 remediation when the bundled server is missing", async () => {
    const r = await probeMcpContextManager({
      env: nodeEnv,
      fileExists: async () => false,
    });
    expect(r.reachable).toBe(false);
    expect(r.reason).toMatch(/not found/i);
    expect(r.suggestedFix).toMatch(/MCP_CONTEXT_MANAGER_PATH|PKG-3/);
  });

  it("does not call the docker probe in node mode", async () => {
    let dockerCalled = false;
    await probeMcpContextManager({
      env: nodeEnv,
      dockerContainerRunning: async () => {
        dockerCalled = true;
        return true;
      },
      fileExists: async () => true,
    });
    expect(dockerCalled).toBe(false);
  });
});
