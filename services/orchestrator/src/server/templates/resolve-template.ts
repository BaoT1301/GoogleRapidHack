import { TemplateModel } from "../../db/models/template.model";

/**
 * TPL-4 — Resolve a pinned persona/rule to the content that should actually
 * drive behavior. The owner's WORKSPACE FORK wins over the seeded DEFAULT, so an
 * edited fork drives both planning (additive plan-request field) and execution
 * (the runtime node prompt). Owner-scoped — never leaks another owner's fork.
 *
 * The Architect (`services/llm`) is stateless and never reads Mongo; this
 * resolution lives in the orchestrator, which owns the template store.
 */

export interface ResolvedTemplate {
  id: string;
  content: string;
  version: string;
  /** "workspace" when the owner has forked it; "default" otherwise. */
  source: "workspace" | "default";
}

async function resolveTemplate(
  ownerId: string,
  id: string,
  kind: "persona" | "rule",
): Promise<ResolvedTemplate | null> {
  if (!ownerId || !id) return null;

  // BFF mode: templates live in the cloud (Atlas via the BFF), not local Mongo, so
  // don't attempt a local read (it would buffer ~10s then fail). Resolve to no
  // overlay; serving personas over the BFF service path is a follow-up.
  if (process.env.BFF_URL) return null;

  try {
    // 1) The owner's workspace fork wins (reproducibility / pinning via version).
    const fork = await TemplateModel.findOne({
      id,
      kind,
      ownerId,
      source: "workspace",
    }).lean();
    if (fork) {
      return { id: fork.id, content: fork.content, version: fork.version, source: "workspace" };
    }

    // 2) Else the seeded default.
    const def = await TemplateModel.findOne({ id, kind, source: "default" }).lean();
    if (def) {
      return { id: def.id, content: def.content, version: def.version, source: "default" };
    }

    return null;
  } catch {
    // DB unreachable (e.g. BFF mode with no local Mongo) — degrade to no persona
    // overlay rather than failing the run. The node still executes from its prompt.
    // (Resolving personas from the BFF service path is a follow-up.)
    return null;
  }
}

/** Resolve a persona id (workspace fork wins over default). */
export function resolvePersona(
  ownerId: string,
  personaId: string,
): Promise<ResolvedTemplate | null> {
  return resolveTemplate(ownerId, personaId, "persona");
}

/** Resolve a rule id (workspace fork wins over default). */
export function resolveRule(
  ownerId: string,
  ruleId: string,
): Promise<ResolvedTemplate | null> {
  return resolveTemplate(ownerId, ruleId, "rule");
}
