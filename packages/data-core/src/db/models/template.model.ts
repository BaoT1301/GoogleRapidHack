import { Schema, model, models, type Model } from "mongoose";

export const TEMPLATE_KINDS = ["persona", "rule", "workflow"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_SOURCES = ["default", "workspace"] as const;
export type TemplateSource = (typeof TEMPLATE_SOURCES)[number];

export interface ITemplate {
  id: string; // e.g. "backend_engineer"
  name: string; // display name
  kind: TemplateKind;
  source: TemplateSource; // "default" = seeded from .claude/personas/, "workspace" = user fork
  content: string; // full markdown
  sha: string; // sha256 of content — persona version tracking in runs
  version: string; // e.g. "default@abc12345"
  ownerId?: string; // undefined for default templates; userId for workspace forks
  createdAt: Date;
  updatedAt: Date;
}

const TemplateSchema = new Schema<ITemplate>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    kind: { type: String, enum: TEMPLATE_KINDS, required: true },
    source: { type: String, enum: TEMPLATE_SOURCES, required: true },
    content: { type: String, required: true },
    sha: { type: String, required: true },
    version: { type: String, required: true },
    ownerId: String,
  },
  { timestamps: true },
);

TemplateSchema.index({ id: 1, source: 1, ownerId: 1 });

export const TemplateModel: Model<ITemplate> =
  (models.Template as Model<ITemplate>) ??
  model<ITemplate>("Template", TemplateSchema);
