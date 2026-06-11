import { beforeEach, describe, expect, it } from "vitest";
import { createCallerFactory, createTRPCContext } from "./init";
import { appRouter } from "./routers/app";

const createCaller = createCallerFactory(appRouter);

describe("createTRPCContext — dev bypass", () => {
  beforeEach(() => {
    process.env.ALLOW_DEV_AUTH = "1";
    delete process.env.CLERK_SECRET_KEY; // force the bypass path
  });

  it("parses dev_<userId> from the Authorization header", async () => {
    const ctx = await createTRPCContext({
      headers: new Headers({ authorization: "Bearer dev_user_42" }),
    });
    expect(ctx.userId).toBe("user_42");
  });

  it("yields null when no auth header is present", async () => {
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.userId).toBeNull();
  });

  it("ignores the bypass when ALLOW_DEV_AUTH is off", async () => {
    process.env.ALLOW_DEV_AUTH = "0";
    const ctx = await createTRPCContext({
      headers: new Headers({ authorization: "Bearer dev_user_42" }),
    });
    expect(ctx.userId).toBeNull();
  });
});

describe("authedProcedure", () => {
  it("auth.whoami returns the userId when authenticated", async () => {
    const caller = createCaller({ userId: "user_1" });
    expect(await caller.auth.whoami()).toEqual({ userId: "user_1" });
  });

  it("auth.whoami throws UNAUTHORIZED when unauthenticated", async () => {
    const caller = createCaller({ userId: null });
    await expect(caller.auth.whoami()).rejects.toThrow("UNAUTHORIZED");
  });

  it("ping is public (works unauthenticated)", async () => {
    const caller = createCaller({ userId: null });
    expect(await caller.ping()).toEqual({ ok: true });
  });
});
