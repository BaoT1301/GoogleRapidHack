import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "../init";
import { TEMPLATE_KINDS } from "../../db/models/template.model";
import { getTemplateGateway } from "../data/template-gateway";
import {
  writeTemplateToDisk,
  ExportContainmentError,
} from "../templates/export-to-disk";

const KindZ = z.enum(TEMPLATE_KINDS);

/**
 * P0-full: templates persistence routes through the template gateway (Mongo by
 * default; the cloud BFF when BFF_URL is set). All DB logic — lazy default-seeding
 * and the CONFLICT/NOT_FOUND/BAD_REQUEST semantics — lives in the gateway so the
 * cloud is the authority. `exportToDisk` is a LOCAL filesystem op: it fetches the
 * fork content through the gateway, then writes locally. `authedProcedure` (not
 * dbProcedure): the Mongo gateway self-connects; the BFF gateway needs no local DB.
 */
export const templatesRouter = createTRPCRouter({
  // Default templates (public) + this user's workspace forks.
  list: authedProcedure
    .input(z.object({ kind: KindZ.optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getTemplateGateway(ctx).list(ctx.userId, input?.kind);
    }),

  getById: authedProcedure
    .input(
      z.object({
        id: z.string(),
        source: z.enum(["default", "workspace"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getTemplateGateway(ctx).getById(ctx.userId, input.id, input.source);
    }),

  // Copy a default template into the user's workspace for editing.
  fork: authedProcedure
    .input(z.object({ templateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return getTemplateGateway(ctx).fork(ctx.userId, input.templateId);
    }),

  // Create a blank owner-scoped workspace template (persona or rule).
  // Rejects collision with an existing fork of the same {id, kind}.
  create: authedProcedure
    .input(
      z.object({
        kind: KindZ,
        name: z.string().min(1),
        content: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return getTemplateGateway(ctx).create(ctx.userId, input);
    }),

  // Duplicate a default OR the owner's own fork into a NEW owner-scoped fork.
  duplicate: authedProcedure
    .input(
      z.object({
        id: z.string(),
        kind: KindZ,
        newName: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return getTemplateGateway(ctx).duplicate(ctx.userId, input);
    }),

  // Edit a workspace fork.
  update: authedProcedure
    .input(z.object({ id: z.string(), content: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return getTemplateGateway(ctx).update(ctx.userId, input.id, input.content);
    }),

  // Delete an owner-scoped workspace fork ONLY. Never deletes a default.
  delete: authedProcedure
    .input(z.object({ id: z.string(), kind: KindZ }))
    .mutation(async ({ ctx, input }) => {
      return getTemplateGateway(ctx).delete(ctx.userId, input.id, input.kind);
    }),

  // Export an owner's workspace fork back to the watched repo's `.claude/` tree.
  // Containment-guarded: refuses the orchestrator's own `.claude/`, traversal,
  // and any path outside the asserted target root (TPL-3). The fork CONTENT is read
  // through the gateway (cloud-aware); the disk write is always LOCAL.
  exportToDisk: authedProcedure
    .input(
      z.object({
        id: z.string(),
        kind: KindZ,
        rootRepoPath: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const fork = await getTemplateGateway(ctx).getWorkspaceFork(
        ctx.userId,
        input.id,
        input.kind,
      );
      if (!fork) throw new TRPCError({ code: "NOT_FOUND" });

      try {
        const writtenPath = await writeTemplateToDisk({
          rootRepoPath: input.rootRepoPath,
          kind: input.kind,
          id: input.id,
          content: fork.content,
        });
        return { writtenPath };
      } catch (err) {
        if (err instanceof ExportContainmentError) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Export failed",
        });
      }
    }),
});
