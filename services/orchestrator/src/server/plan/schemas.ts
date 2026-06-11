import { z } from "zod";

/**
 * Zod schemas for the canonical Architect plan contract
 * (`.claude/docs/core/api-contracts/architect-plan-api.md` §3). These validate the
 * **Local** CLI planner's parsed output so it is byte-compatible with the Cloud
 * Architect's response. The Cloud path is intentionally NOT zod-validated (it is
 * returned as-is to stay 100% backward-compatible — see CloudArchitectProvider).
 *
 * Soft fields use `.default()` so a well-formed-but-terse agent response still
 * validates; identity/discriminator fields stay required so a malformed blob is
 * rejected and triggers the one-shot retry.
 */

export const PLAN_PERSONAS = [
  "frontend_architect",
  "backend_engineer",
  "internal_tooling_engineer",
  "devops_qa_engineer",
  "integration_reviewer",
  "knowledge_manager",
  "product_architect",
] as const;

// ---- ContextRequest (Socratic loop response) -------------------------------

export const ApproachSchema = z.object({
  name: z.string(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
});

export const QuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: z.string().optional(),
});

export const ContextRequestSchema = z.object({
  type: z.literal("context_request"),
  confidence: z.number().min(0).max(1).default(0),
  readyToPlan: z.boolean().default(false),
  codebaseImpact: z.string().default(""),
  approaches: z.array(ApproachSchema).default([]),
  questions: z.array(QuestionSchema).max(20).default([]),
  missingContext: z.array(z.string()).default([]),
});

// ---- GraphSpec (approved → execution queue) --------------------------------

export const SprintSchema = z.object({
  number: z.number(),
  name: z.string(),
  tasks: z.array(z.string()).default([]),
});

export const TrackSchema = z.object({
  id: z.string(),
  number: z.number().default(0),
  execution: z.enum(["SEQUENTIAL", "PARALLEL"]).default("SEQUENTIAL"),
  // Accept any persona string but prefer the canonical set; unknown personas are
  // allowed through (the canvas renders them) rather than failing the whole plan.
  persona: z.string(),
  name: z.string(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"]).default("PENDING"),
  overview: z.string().default(""),
  checklist: z.array(z.string()).min(1),
  dependsOn: z.array(z.string()).default([]),
});

export const GraphSpecSchema = z.object({
  type: z.literal("graph_spec"),
  version: z.string().default("1.0"),
  featureName: z.string(),
  sprintNumber: z.number().default(1),
  backlog: z.object({ sprints: z.array(SprintSchema).default([]) }).optional(),
  tracks: z.array(TrackSchema).min(1).max(8),
  missingContext: z.array(z.string()).default([]),
});

/** Discriminated union — the canonical top-level plan result. */
export const PlanResultSchema = z.discriminatedUnion("type", [
  ContextRequestSchema,
  GraphSpecSchema,
]);

export type ContextRequest = z.infer<typeof ContextRequestSchema>;
export type GraphSpec = z.infer<typeof GraphSpecSchema>;
export type PlanResult = z.infer<typeof PlanResultSchema>;

export type ParseResult =
  | { ok: true; value: PlanResult }
  | { ok: false; error: string };

/** Parse a raw JSON string into a validated PlanResult (never throws). */
export function parsePlanResult(jsonText: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = PlanResultSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `does not match the plan contract: ${parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")}` };
  }
  return { ok: true, value: parsed.data };
}
