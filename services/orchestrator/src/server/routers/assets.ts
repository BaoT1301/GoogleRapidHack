import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "../init";
import { getAssetGateway } from "../data/asset-gateway";
import {
  ALLOWED_ASSET_TYPES,
  MAX_ASSET_BYTES,
  validateAsset,
} from "../assets/validate";

/**
 * Canvas asset pipeline (Theme Pack game assets). Owner-scoped CRUD over
 * user-imported images. Bytes arrive base64-encoded (small sprites), are
 * decoded + validated (type + size) on the input boundary; the gateway persists
 * them. Raw bytes are served by `/api/assets/[id]` (which proxies to the BFF
 * `/assets/:id/bytes` route in BFF mode); these procedures return metadata + a
 * capability URL only (never the bytes, to keep payloads light).
 *
 * P0-full: persistence routes through the asset gateway (Mongo by default; the
 * cloud BFF when BFF_URL is set). `authedProcedure` (not dbProcedure): the Mongo
 * gateway self-connects; the BFF gateway needs no local DB. The BFF re-validates
 * type/size too (defense in depth) before write.
 */

export const assetsRouter = createTRPCRouter({
  list: authedProcedure.query(({ ctx }) => getAssetGateway(ctx).list(ctx.userId)),

  get: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => getAssetGateway(ctx).get(ctx.userId, input.id)),

  upload: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        contentType: z.enum(ALLOWED_ASSET_TYPES),
        /** Base64-encoded file bytes (no data-URI prefix). */
        dataBase64: z.string().min(1),
        pixelated: z.boolean().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let bytes: Buffer;
      try {
        bytes = Buffer.from(input.dataBase64, "base64");
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid base64" });
      }
      const check = validateAsset({ contentType: input.contentType, size: bytes.length });
      if (!check.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
      }
      return getAssetGateway(ctx).create(ctx.userId, {
        name: input.name,
        contentType: input.contentType,
        bytes,
        pixelated: input.pixelated,
        width: input.width,
        height: input.height,
      });
    }),

  remove: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => getAssetGateway(ctx).remove(ctx.userId, input.id)),
});

export { MAX_ASSET_BYTES };
