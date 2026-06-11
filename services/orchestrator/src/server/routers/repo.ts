import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "../init";
import { resolveDefaultRepoRoot } from "../graphs/default-repo-root";
import { listDir } from "../graphs/list-dir";
import { listBranches } from "../graphs/list-branches";

/**
 * Repo-picker support router (read-only). Backs the smart repo-path + base-branch
 * pickers in the create-graph dialog and the canvas inspector:
 *
 *   • `defaultRoot`  — the git root of the server's cwd (fallback: cwd).
 *   • `listDir`      — server-side directory browser (dirs only, git flags).
 *   • `listBranches` — local branches of a repo path for the branch combobox.
 *
 * All three are owner-gated (`authedProcedure`) but path-oriented, not
 * graph-scoped — they take a filesystem path, not a graphId. They are READ-ONLY
 * and never throw (helpers degrade fail-soft). NB: `listDir` exposes directory
 * names on the host to the authenticated owner — acceptable for this local,
 * single-owner tool (see `list-dir.ts` SECURITY note).
 */
export const repoRouter = createTRPCRouter({
  // Smart default repo path = git top-level of the server cwd (else cwd).
  defaultRoot: authedProcedure.query(() => resolveDefaultRepoRoot()),

  // Read-only directory browser for the repo-path picker modal.
  listDir: authedProcedure
    .input(z.object({ path: z.string().optional() }))
    .query(({ input }) => listDir({ path: input.path })),

  // Local branches for the base-branch combobox.
  listBranches: authedProcedure
    .input(z.object({ path: z.string().optional() }))
    .query(({ input }) => listBranches({ path: input.path })),
});
