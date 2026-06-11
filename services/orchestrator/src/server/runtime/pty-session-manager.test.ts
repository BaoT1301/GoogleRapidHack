import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  PtySessionManager,
  resolvePtyIdleMs,
  type PtyLike,
  type PtySpawnFn,
} from "./pty-session-manager";

// A controllable fake PTY so we never spawn a real shell in unit tests.
class FakePty implements PtyLike {
  readonly pid = 4242;
  dataCb?: (d: string) => void;
  exitCb?: (e: { exitCode: number; signal?: number }) => void;
  written: string[] = [];
  resized: Array<[number, number]> = [];
  killed = false;
  onData(cb: (d: string) => void) {
    this.dataCb = cb;
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
    this.exitCb = cb;
  }
  write(d: string) {
    this.written.push(d);
  }
  resize(c: number, r: number) {
    this.resized.push([c, r]);
  }
  kill() {
    this.killed = true;
    this.exitCb?.({ exitCode: 0, signal: 15 });
  }
  emit(d: string) {
    this.dataCb?.(d);
  }
}

function managerWithFake(idleMs?: number) {
  const fake = new FakePty();
  const spawn: PtySpawnFn = () => fake;
  const mgr = new PtySessionManager({ spawn, idleMs });
  return { mgr, fake };
}

const base = {
  sessionId: "s1",
  runId: "r1",
  nodeId: "n1",
  cwd: tmpdir(), // an existing dir so the existsSync guard passes
  onData: () => {},
  onExit: () => {},
};

describe("PtySessionManager", () => {
  it("creates a session, streams data, writes input, and resizes", async () => {
    const { mgr, fake } = managerWithFake();
    const onData = vi.fn();
    const { pid } = await mgr.create({ ...base, onData });
    expect(pid).toBe(4242);
    expect(mgr.has("s1")).toBe(true);

    fake.emit("hello");
    expect(onData).toHaveBeenCalledWith("hello");

    mgr.write("s1", "ls\r");
    expect(fake.written).toContain("ls\r");

    mgr.resize("s1", 120, 40);
    expect(fake.resized).toContainEqual([120, 40]);
  });

  it("rejects a non-existent worktree path", async () => {
    const { mgr } = managerWithFake();
    await expect(
      mgr.create({ ...base, cwd: "/no/such/worktree/here" }),
    ).rejects.toThrow(/does not exist/i);
  });

  it("kill() terminates the pty and forgets the session", async () => {
    const { mgr, fake } = managerWithFake();
    await mgr.create(base);
    expect(mgr.kill("s1")).toBe(true);
    expect(fake.killed).toBe(true);
    expect(mgr.has("s1")).toBe(false);
  });

  it("killForNode() reaps every shell bound to a node", async () => {
    const { mgr } = managerWithFake();
    await mgr.create({ ...base, sessionId: "a" });
    // second session for same node needs its own fake — use a fresh manager spawn
    const fake2 = new FakePty();
    // @ts-expect-error swap the spawn fn for a second distinct pty
    mgr.spawnFn = () => fake2;
    await mgr.create({ ...base, sessionId: "b" });
    expect(mgr.killForNode("r1", "n1")).toBe(2);
    expect(mgr.size).toBe(0);
  });

  it("idle timeout reaps an abandoned session", async () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    const { mgr, fake } = managerWithFake(50);
    await mgr.create({ ...base, onExit });
    vi.advanceTimersByTime(60);
    expect(fake.killed).toBe(true);
    expect(onExit).toHaveBeenCalled();
    expect(mgr.has("s1")).toBe(false);
    vi.useRealTimers();
  });

  it("resolvePtyIdleMs honors explicit > env > default", () => {
    expect(resolvePtyIdleMs(1234)).toBe(1234);
    expect(resolvePtyIdleMs(0)).toBe(10 * 60 * 1000);
  });
});
