import { authedProcedure, createTRPCRouter, publicProcedure } from "../init";
import { graphsRouter } from "./graphs";
import { runsRouter } from "./runs";
import { templatesRouter } from "./templates";
import { secretsRouter } from "./secrets";
import { planRouter } from "./plan";
import { runtimeRouter } from "./runtime";
import { systemRouter } from "./system";
import { settingsRouter } from "./settings";
import { skillsRouter } from "./skills";
import { projectsRouter } from "./projects";
import { kbRouter } from "./kb";
import { aiRouter } from "./ai";
import { repoRouter } from "./repo";
import { assetsRouter } from "./assets";
import { themePacksRouter } from "./themePacks";

/**
 * Root tRPC router. Feature routers are added here as phases land:
 *   graphs (P4 ✅), runs (P5), templates + secrets (P6), plan (Nhi).
 *
 * The exported `AppRouter` type is the type-safe contract LA + Nhi import on the client.
 */
export const appRouter = createTRPCRouter({
  // Public liveness — no auth.
  ping: publicProcedure.query(() => ({ ok: true })),

  auth: createTRPCRouter({
    // Smoke procedure: returns the resolved userId (proves auth end-to-end).
    whoami: authedProcedure.query(({ ctx }) => ({ userId: ctx.userId })),
  }),

  graphs: graphsRouter,
  runs: runsRouter,
  templates: templatesRouter,
  secrets: secretsRouter,
  plan: planRouter,
  runtime: runtimeRouter,
  system: systemRouter,
  settings: settingsRouter,
  skills: skillsRouter,
  projects: projectsRouter,
  kb: kbRouter,
  ai: aiRouter,
  repo: repoRouter,
  assets: assetsRouter,
  themePacks: themePacksRouter,
});

export type AppRouter = typeof appRouter;
