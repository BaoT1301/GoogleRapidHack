import { Schema, model, models, type Model } from "mongoose";

/**
 * Per-project workspace (Cloud Infra P1, D7).
 *
 * A user works across multiple repos; scoping state (KB, graphs, runs, settings)
 * by `ownerId + projectId` means sign-in restores the right project and the
 * codebase KB is keyed correctly for retrieval. `projectId` is an app-generated
 * id (ulid); `rootRepoPath` is the local repo this project tracks.
 *
 * Tenant isolation is manual (every query scoped by ownerId), matching the rest
 * of the app (ADR AD-3). No secrets are stored here.
 */
export interface IProject {
  ownerId: string; // Clerk userId
  projectId: string; // app-generated (ulid), unique per owner
  name: string;
  rootRepoPath?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    ownerId: { type: String, required: true, index: true },
    projectId: { type: String, required: true },
    name: { type: String, required: true },
    rootRepoPath: { type: String },
    remoteUrl: { type: String },
    defaultBranch: { type: String },
  },
  { timestamps: true },
);

// One project doc per (owner, projectId); fast list-by-owner.
ProjectSchema.index({ ownerId: 1, projectId: 1 }, { unique: true });
ProjectSchema.index({ ownerId: 1, updatedAt: -1 });

export const ProjectModel: Model<IProject> =
  (models.Project as Model<IProject>) ?? model<IProject>("Project", ProjectSchema);
