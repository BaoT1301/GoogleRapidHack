import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "../init";
import { readSkillsRegistry, type SkillListItem } from "../skills/skills-registry";
import { installSkill, removeSkill, repinSkill } from "../skills/skill-installer";
import { SkillSourceError, type SkillSourceErrorCode } from "../skills/skill-source";
import { getSecretValue } from "../secrets/vault";

/**
 * SKILL-2 + SKILL-INSTALL — skills surface.
 *   - `list`   → read-only parse of the repo-root `skills-lock.json` (UI list).
 *   - `add`    → install a skill from a source (provider-based fetch + integrity
 *                hash + atomic store + lockfile write). The token, when needed for
 *                a private source, is resolved SERVER-SIDE from the secrets vault
 *                (`tokenSecretId`) — a raw token is never accepted over the wire.
 *   - `repin`  → re-resolve an installed skill to the newest commit + re-fetch.
 *   - `remove` → drop the lockfile entry + delete the on-disk store dir.
 *
 * Install/remove/repin are GLOBAL (the lockfile is a single shared repo-root file)
 * but authed. Mutations never echo the token; provider errors map to safe codes.
 */

/** Map a provider/installer error code to a tRPC error code. */
function trpcCodeFor(code: SkillSourceErrorCode): TRPCError["code"] {
  switch (code) {
    case "not-found":
      return "NOT_FOUND";
    case "auth":
      return "FORBIDDEN";
    case "network":
      return "INTERNAL_SERVER_ERROR";
    default:
      return "BAD_REQUEST"; // no-provider, invalid-ref, too-large, unsafe-entry
  }
}

async function withMappedErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SkillSourceError) {
      throw new TRPCError({ code: trpcCodeFor(e.code), message: e.message });
    }
    throw e;
  }
}

export const skillsRouter = createTRPCRouter({
  list: authedProcedure.query(async (): Promise<SkillListItem[]> => {
    return readSkillsRegistry();
  }),

  add: authedProcedure
    .input(
      z.object({
        source: z.string().min(1).max(512),
        id: z.string().max(64).optional(),
        /** Vault secret id holding a GitHub token (private repos / rate limits). */
        tokenSecretId: z.string().max(128).optional(),
        overwrite: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const token = input.tokenSecretId
        ? (await getSecretValue(ctx.userId, input.tokenSecretId)) ?? undefined
        : undefined;
      const { id, entry } = await withMappedErrors(() =>
        installSkill({
          source: input.source,
          id: input.id,
          token,
          overwrite: input.overwrite,
        }),
      );
      // Never return the token; surface only the safe persisted fields.
      return {
        id,
        source: entry.source,
        sourceType: entry.sourceType,
        commit: entry.commit,
        computedHash: entry.computedHash,
      };
    }),

  repin: authedProcedure
    .input(z.object({ id: z.string().min(1).max(64), tokenSecretId: z.string().max(128).optional() }))
    .mutation(async ({ ctx, input }) => {
      const token = input.tokenSecretId
        ? (await getSecretValue(ctx.userId, input.tokenSecretId)) ?? undefined
        : undefined;
      const { id, entry } = await withMappedErrors(() => repinSkill(input.id, { token }));
      return { id, commit: entry.commit, computedHash: entry.computedHash };
    }),

  remove: authedProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      return withMappedErrors(() => removeSkill(input.id));
    }),
});
