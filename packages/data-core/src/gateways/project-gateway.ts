// ProjectGateway — persistence seam for the `projects` domain (shared data-core).
// Mongo impl + shared types; the orchestrator adds the BFF variant + selector.
import { ulid } from "ulid";
import { connectDB } from "../db/client";
import { ProjectModel, type IProject } from "../db/models/project.model";

export type ProjectRecord = IProject & { _id?: unknown };

export interface ProjectCreateInput {
  name: string;
  rootRepoPath?: string;
  remoteUrl?: string;
  defaultBranch?: string;
}
export interface ProjectUpdateInput {
  name?: string;
  rootRepoPath?: string;
  remoteUrl?: string;
  defaultBranch?: string;
}

export interface ProjectGateway {
  list(ownerId: string): Promise<ProjectRecord[]>;
  get(ownerId: string, projectId: string): Promise<ProjectRecord | null>;
  create(ownerId: string, input: ProjectCreateInput): Promise<ProjectRecord>;
  update(ownerId: string, projectId: string, updates: ProjectUpdateInput): Promise<ProjectRecord | null>;
  delete(ownerId: string, projectId: string): Promise<boolean>;
}

/** Direct-Mongo implementation — the shipped behavior. */
export class MongoProjectGateway implements ProjectGateway {
  async list(ownerId: string): Promise<ProjectRecord[]> {
    await connectDB();
    return ProjectModel.find({ ownerId }).sort({ updatedAt: -1 }).lean();
  }

  async get(ownerId: string, projectId: string): Promise<ProjectRecord | null> {
    await connectDB();
    return ProjectModel.findOne({ ownerId, projectId }).lean();
  }

  async create(ownerId: string, input: ProjectCreateInput): Promise<ProjectRecord> {
    await connectDB();
    const project = await ProjectModel.create({
      ownerId,
      projectId: ulid(),
      ...input,
    });
    return project.toObject();
  }

  async update(ownerId: string, projectId: string, updates: ProjectUpdateInput): Promise<ProjectRecord | null> {
    await connectDB();
    return ProjectModel.findOneAndUpdate(
      { ownerId, projectId },
      { $set: updates },
      { new: true },
    ).lean();
  }

  async delete(ownerId: string, projectId: string): Promise<boolean> {
    await connectDB();
    const res = await ProjectModel.deleteOne({ ownerId, projectId });
    return res.deletedCount === 1;
  }
}

export const mongoProjectGateway = new MongoProjectGateway();
