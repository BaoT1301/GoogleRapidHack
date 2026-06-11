import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/app";

// Type-only helpers — erased at build time (no server code in the client bundle).
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type GraphListItem = RouterOutputs["graphs"]["list"][number];
export type GraphDetail = RouterOutputs["graphs"]["getById"];
export type TemplateItem = RouterOutputs["templates"]["list"][number];
export type RunDetail = RouterOutputs["runs"]["getById"];
export type RunListItem = RouterOutputs["runs"]["listForGraph"][number];
