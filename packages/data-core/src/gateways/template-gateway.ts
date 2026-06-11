// TemplateGateway — persistence seam for the `templates` domain (personas/rules/
// workflows) (shared data-core). Mongo impl (incl. lazy default-seeding + the
// CONFLICT/NOT_FOUND semantics) + shared types live here; the orchestrator adds the
// BFF variant + selector. exportToDisk is a LOCAL filesystem op and stays in the router.
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { connectDB } from "../db/client";
import {
  TemplateModel,
  type ITemplate,
  type TemplateKind,
} from "../db/models/template.model";
import { ensureTemplatesSeeded } from "../templates/seed";

export type TemplateRecord = ITemplate & { _id?: unknown };
export type TemplateSourceFilter = "default" | "workspace";

export interface TemplateCreateInput {
  kind: TemplateKind;
  name: string;
  content?: string;
}
export interface TemplateDuplicateInput {
  id: string;
  kind: TemplateKind;
  newName?: string;
}

export interface TemplateGateway {
  list(ownerId: string, kind?: TemplateKind): Promise<TemplateRecord[]>;
  getById(ownerId: string, id: string, source?: TemplateSourceFilter): Promise<TemplateRecord>;
  fork(ownerId: string, templateId: string): Promise<TemplateRecord>;
  create(ownerId: string, input: TemplateCreateInput): Promise<TemplateRecord>;
  duplicate(ownerId: string, input: TemplateDuplicateInput): Promise<TemplateRecord>;
  update(ownerId: string, id: string, content: string): Promise<TemplateRecord>;
  delete(ownerId: string, id: string, kind: TemplateKind): Promise<{ id: string; kind: TemplateKind; deleted: true }>;
  /** Fetch the owner's workspace fork content (for the LOCAL exportToDisk). Null if none. */
  getWorkspaceFork(ownerId: string, id: string, kind: TemplateKind): Promise<TemplateRecord | null>;
}

/** Derive a stable, filesystem-safe template id from a display name. */
function slugifyId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function shaOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Direct-Mongo implementation — the shipped behavior (seeding + error semantics). */
export class MongoTemplateGateway implements TemplateGateway {
  async list(ownerId: string, kind?: TemplateKind): Promise<TemplateRecord[]> {
    await connectDB();
    await ensureTemplatesSeeded();
    const query: Record<string, unknown> = {
      $or: [{ source: "default" }, { ownerId }],
    };
    if (kind) query.kind = kind;
    return TemplateModel.find(query).sort({ id: 1 }).lean();
  }

  async getById(ownerId: string, id: string, source?: TemplateSourceFilter): Promise<TemplateRecord> {
    await connectDB();
    await ensureTemplatesSeeded();
    const query: Record<string, unknown> = { id };
    if (source === "workspace") query.ownerId = ownerId;
    else if (source === "default") query.source = "default";
    else query.$or = [{ source: "default" }, { ownerId }];
    const tpl = await TemplateModel.findOne(query).lean();
    if (!tpl) throw new TRPCError({ code: "NOT_FOUND" });
    return tpl;
  }

  async fork(ownerId: string, templateId: string): Promise<TemplateRecord> {
    await connectDB();
    await ensureTemplatesSeeded();
    const def = await TemplateModel.findOne({ id: templateId, source: "default" }).lean();
    if (!def) throw new TRPCError({ code: "NOT_FOUND" });
    const forked = await TemplateModel.findOneAndUpdate(
      { id: templateId, ownerId, source: "workspace" },
      {
        id: def.id,
        name: def.name,
        kind: def.kind,
        source: "workspace",
        ownerId,
        content: def.content,
        sha: def.sha,
        version: def.version,
      },
      { upsert: true, new: true },
    ).lean();
    return forked!;
  }

  async create(ownerId: string, input: TemplateCreateInput): Promise<TemplateRecord> {
    await connectDB();
    await ensureTemplatesSeeded();
    const id = slugifyId(input.name);
    if (!id) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid name" });
    const existing = await TemplateModel.findOne({
      id,
      kind: input.kind,
      ownerId,
      source: "workspace",
    }).lean();
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A workspace ${input.kind} with id "${id}" already exists`,
      });
    }
    const content = input.content && input.content.length > 0 ? input.content : `# ${input.name}\n`;
    const sha = shaOf(content);
    const created = await TemplateModel.create({
      id,
      name: input.name,
      kind: input.kind,
      source: "workspace",
      ownerId,
      content,
      sha,
      version: `workspace@${sha.slice(0, 8)}`,
    });
    return created.toObject();
  }

  async duplicate(ownerId: string, input: TemplateDuplicateInput): Promise<TemplateRecord> {
    await connectDB();
    await ensureTemplatesSeeded();
    const src = await TemplateModel.findOne({
      id: input.id,
      kind: input.kind,
      $or: [{ source: "default" }, { ownerId }],
    }).lean();
    if (!src) throw new TRPCError({ code: "NOT_FOUND" });
    const newName = input.newName ?? `${src.name} (copy)`;
    const newId = input.newName ? slugifyId(input.newName) : `${src.id}_copy`;
    if (!newId) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid newName" });
    const collision = await TemplateModel.findOne({
      id: newId,
      kind: input.kind,
      ownerId,
      source: "workspace",
    }).lean();
    if (collision) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A workspace ${input.kind} with id "${newId}" already exists`,
      });
    }
    const sha = shaOf(src.content);
    const dup = await TemplateModel.create({
      id: newId,
      name: newName,
      kind: input.kind,
      source: "workspace",
      ownerId,
      content: src.content,
      sha,
      version: `workspace@${sha.slice(0, 8)}`,
    });
    return dup.toObject();
  }

  async update(ownerId: string, id: string, content: string): Promise<TemplateRecord> {
    await connectDB();
    const sha = shaOf(content);
    const tpl = await TemplateModel.findOneAndUpdate(
      { id, ownerId, source: "workspace" },
      { $set: { content, sha, version: `workspace@${sha.slice(0, 8)}` } },
      { new: true },
    ).lean();
    if (!tpl) throw new TRPCError({ code: "NOT_FOUND" });
    return tpl;
  }

  async delete(ownerId: string, id: string, kind: TemplateKind) {
    await connectDB();
    const deleted = await TemplateModel.findOneAndDelete({
      id,
      kind,
      ownerId,
      source: "workspace",
    }).lean();
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
    return { id: deleted.id, kind: deleted.kind, deleted: true as const };
  }

  async getWorkspaceFork(ownerId: string, id: string, kind: TemplateKind): Promise<TemplateRecord | null> {
    await connectDB();
    return TemplateModel.findOne({ id, kind, ownerId, source: "workspace" }).lean();
  }
}

export const mongoTemplateGateway = new MongoTemplateGateway();
