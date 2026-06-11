import { describe, expect, it } from "vitest";
import { assertSafeGitArgs, isDestructiveGitCommand } from "./git-guard";

describe("git-guard — isDestructiveGitCommand (SEC-6)", () => {
  it("rejects force-push variants", () => {
    expect(isDestructiveGitCommand(["push", "--force"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["push", "origin", "main", "-f"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["push", "--force-with-lease"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["push", "--force-with-lease=main"]).destructive).toBe(true);
  });

  it("rejects reset --hard", () => {
    expect(isDestructiveGitCommand(["reset", "--hard", "HEAD~1"]).destructive).toBe(true);
    // a soft/mixed reset is allowed
    expect(isDestructiveGitCommand(["reset", "--soft", "HEAD~1"]).destructive).toBe(false);
  });

  it("rejects clean -f / -fd / -fdx", () => {
    expect(isDestructiveGitCommand(["clean", "-f"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["clean", "-fd"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["clean", "-fdx"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["clean", "--force"]).destructive).toBe(true);
    // a dry-run clean is allowed
    expect(isDestructiveGitCommand(["clean", "-n"]).destructive).toBe(false);
  });

  it("rejects branch -D of a NON-orchestrator branch but ALLOWS its own branches", () => {
    expect(isDestructiveGitCommand(["branch", "-D", "main"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["branch", "-D", "develop"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["branch", "-D", "agent/run1/node1"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["branch", "-D", "integration/run1/node1"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["branch", "-D", "merge/run1/node1"]).destructive).toBe(false);
  });

  it("rejects git rm -r/-f", () => {
    expect(isDestructiveGitCommand(["rm", "-rf", "src"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["rm", "-f", "x"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["rm", "-r", "dir"]).destructive).toBe(true);
  });

  it("PASSES the orchestrator's known-safe ops unchanged", () => {
    const safe: string[][] = [
      ["worktree", "add", "--no-checkout", "-b", "agent/r/n", "/p", "HEAD"],
      ["worktree", "remove", "--force", "/p/.orchestrator/worktrees/r/n"],
      ["worktree", "prune"],
      ["checkout", "--force"],
      ["merge", "--ff-only", "abc123"],
      ["merge", "--no-edit", "--no-ff", "integration/r/n"],
      ["update-ref", "refs/heads/main", "abc", "def"],
      ["update-ref", "refs/orch-backup/main/r", "abc"],
      ["diff", "--name-only", "HEAD...HEAD"],
      ["status", "--porcelain"],
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["config", "user.email", "orchestrator@local"],
      ["add", "-A"],
      ["commit", "-m", "checkpoint"],
    ];
    for (const args of safe) {
      expect(isDestructiveGitCommand(args), `should be safe: git ${args.join(" ")}`).toMatchObject({
        destructive: false,
      });
    }
  });

  it("tolerates a leading -C <cwd> prefix", () => {
    expect(isDestructiveGitCommand(["-C", "/repo", "reset", "--hard"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["-C", "/repo", "worktree", "prune"]).destructive).toBe(false);
  });

  it("never throws on garbage input", () => {
    expect(isDestructiveGitCommand([]).destructive).toBe(false);
    expect(isDestructiveGitCommand(undefined as unknown as string[]).destructive).toBe(false);
  });
});

describe("git-guard — assertSafeGitArgs", () => {
  it("throws on a destructive op with a clear SEC-6 message", () => {
    expect(() => assertSafeGitArgs(["reset", "--hard"])).toThrowError(/SEC-6/);
    expect(() => assertSafeGitArgs(["push", "--force"])).toThrowError(/destructive/i);
  });

  it("is a pass-through (no throw) for a safe op", () => {
    expect(() => assertSafeGitArgs(["worktree", "remove", "--force", "/p"])).not.toThrow();
    expect(() => assertSafeGitArgs(["merge", "--ff-only", "abc"])).not.toThrow();
    expect(() => assertSafeGitArgs(["branch", "-D", "agent/r/n"])).not.toThrow();
  });
});
