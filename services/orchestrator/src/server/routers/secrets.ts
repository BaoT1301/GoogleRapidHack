import { z } from "zod";
import { authedProcedure, createTRPCRouter } from "../init";
import { getSecretGateway } from "../data/secret-gateway";

// NOTE: there is intentionally NO `getValue` procedure here. Decryption is
// server-internal (the runtime calls the gateway's getValue), never exposed to the
// client. P0-full: persistence routes through the secret gateway (Mongo + local
// vault by default; the cloud BFF over the SERVICE path when BFF_URL is set, where
// the vault passphrase lives ONLY on the BFF). authedProcedure (not dbProcedure):
// the Mongo gateway self-connects; the BFF gateway needs no local DB.
export const secretsRouter = createTRPCRouter({
  // Labels only — never returns ciphertext.
  list: authedProcedure.query(async ({ ctx }) => {
    return getSecretGateway().list(ctx.userId);
  }),

  create: authedProcedure
    .input(z.object({ label: z.string().min(1).max(120), value: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return getSecretGateway().create(ctx.userId, input.label, input.value);
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const success = await getSecretGateway().delete(ctx.userId, input.id);
      return { success };
    }),
});
