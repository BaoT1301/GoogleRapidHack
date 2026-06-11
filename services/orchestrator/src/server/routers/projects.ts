import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "../init";
import { getProjectGateway } from "../data/project-gateway";

/**
 * Per-project workspace router (Cloud Infra P1, D7).
 *
 * Scopes a user's work by `ownerId + projectId` so sign-in restores the right
 * project and the codebase KB (P3) is keyed correctly. Every op is owner-scoped —
 * Clerk auth + manual tenant isolation (ADR AD-3). P0-full: persistence routes
 * through the project gateway (Mongo by default; the cloud BFF when BFF_URL is set).
 * `authedProcedure` (not dbProcedure): the Mongo gateway self-connects; the BFF
 * gateway needs no local DB.
 */
export const projectsRouter = createTRPCRouter({
  // List the signed-in user's projects, most-recently-updated first.
  list: authedProcedure.query(async ({ ctx }) => {
    return getProjectGateway(ctx).list(ctx.userId);
  }),

  // Single project by id (scoped).
  get: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectGateway(ctx).get(ctx.userId, input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return project;
    }),

  // Create a project (server-generates the projectId).
  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        rootRepoPath: z.string().optional(),
        remoteUrl: z.string().optional(),
        defaultBranch: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return getProjectGateway(ctx).create(ctx.userId, input);
    }),

  // Update mutable fields (name / repo path / remote / branch).
  update: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(200).optional(),
        rootRepoPath: z.string().optional(),
        remoteUrl: z.string().optional(),
        defaultBranch: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, ...updates } = input;
      const project = await getProjectGateway(ctx).update(ctx.userId, projectId, updates);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return project;
    }),

  // Delete a project (does not cascade — KB cleanup is a follow-up).
  delete: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const success = await getProjectGateway(ctx).delete(ctx.userId, input.projectId);
      return { success };
    }),
});
