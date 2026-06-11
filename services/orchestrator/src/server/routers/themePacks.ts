import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "../init";
import { getThemePackGateway } from "../data/theme-pack-gateway";
import { safeParseThemePack, type ThemePack } from "../../lib/canvas-theme/schema";

/**
 * User custom theme packs. The client assembles a candidate pack (see
 * `buildCustomPack`) and sends it here; the server RE-VALIDATES it against the
 * Theme Pack schema (never trusts the client), then the gateway persists it.
 *
 * P0-full: persistence routes through the themePack gateway (Mongo by default; the
 * cloud BFF when BFF_URL is set). `authedProcedure` (not dbProcedure): the Mongo
 * gateway self-connects; the BFF gateway needs no local DB. The BFF re-validates
 * shape too (defense in depth) before write.
 */

/** Validate an unknown candidate pack, or throw a 400 with the zod message. */
function validatePack(candidate: unknown): ThemePack {
  const res = safeParseThemePack(candidate);
  if (!res.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid theme pack: ${res.error.issues[0]?.message ?? "unknown"}`,
    });
  }
  return res.data;
}

export const themePacksRouter = createTRPCRouter({
  list: authedProcedure.query(async ({ ctx }) => {
    return (await getThemePackGateway(ctx).list(ctx.userId)) as ThemePack[];
  }),

  get: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return (await getThemePackGateway(ctx).get(ctx.userId, input.id)) as ThemePack;
    }),

  create: authedProcedure
    .input(z.object({ name: z.string().min(1).max(120), pack: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const pack = validatePack(input.pack);
      // Server owns id (gateway mints) + name (gateway stamps) — no spoofing /
      // collisions with built-in pack ids.
      return (await getThemePackGateway(ctx).create(ctx.userId, {
        name: input.name,
        // The gateway re-stamps id/name, but we hand it the validated body.
        pack: { ...pack, name: input.name },
      })) as ThemePack;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        pack: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const pack = input.pack !== undefined ? validatePack(input.pack) : undefined;
      return (await getThemePackGateway(ctx).update(ctx.userId, input.id, {
        name: input.name,
        pack,
      })) as ThemePack;
    }),

  remove: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return getThemePackGateway(ctx).remove(ctx.userId, input.id);
    }),
});
