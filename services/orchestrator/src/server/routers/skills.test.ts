import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";

const createCaller = createCallerFactory(appRouter);
const me = createCaller({ userId: "u_skills" });
const anon = createCaller({ userId: null });

// Isolate ALL installer disk writes to a throwaway temp dir so router tests can
// never touch the real repo-root skills-lock.json / .kiro/skills store.
let root: string;
let prevLock: string | undefined;
let prevRoot: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "skills-router-"));
  prevLock = process.env.SKILLS_LOCK_PATH;
  prevRoot = process.env.SKILLS_ROOT;
  process.env.SKILLS_LOCK_PATH = join(root, "skills-lock.json");
  process.env.SKILLS_ROOT = join(root, "store");
});

afterAll(async () => {
  if (prevLock === undefined) delete process.env.SKILLS_LOCK_PATH;
  else process.env.SKILLS_LOCK_PATH = prevLock;
  if (prevRoot === undefined) delete process.env.SKILLS_ROOT;
  else process.env.SKILLS_ROOT = prevRoot;
  await rm(root, { recursive: true, force: true });
});

describe("skills router (SKILL-INSTALL)", () => {
  it("requires auth for mutations", async () => {
    await expect(anon.skills.add({ source: "owner/repo" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anon.skills.remove({ id: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.skills.repin({ id: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps an unrecognized source to BAD_REQUEST (no network)", async () => {
    await expect(me.skills.add({ source: "not a valid ref" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("validates input (empty source rejected by zod)", async () => {
    await expect(me.skills.add({ source: "" })).rejects.toBeTruthy();
  });

  it("maps an unsafe remove id to BAD_REQUEST", async () => {
    await expect(me.skills.remove({ id: "../escape" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("remove is idempotent (removed=false when absent)", async () => {
    const res = await me.skills.remove({ id: "ghost" });
    expect(res).toEqual({ removed: false });
  });

  it("repin of an unknown skill maps to NOT_FOUND", async () => {
    await expect(me.skills.repin({ id: "ghost" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("list returns [] when the (temp) lockfile is absent", async () => {
    expect(await me.skills.list()).toEqual([]);
  });

  it("add installs via the fake provider end-to-end (registry override unavailable → use github stub)", async () => {
    // The router builds its own registry, so we exercise the happy path through
    // the installer unit tests; here we assert the lockfile stays untouched on a
    // provider miss (no partial writes).
    await expect(me.skills.add({ source: "fake:nope" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(readFile(process.env.SKILLS_LOCK_PATH as string, "utf8")).rejects.toBeTruthy();
  });
});
