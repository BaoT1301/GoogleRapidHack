// getRunRepository — selects the runtime's persistence backend per run.
//
// Default: MongoRunRepository (direct Mongo, shipped behavior). BFF mode (BFF_URL set):
// BffRunRepository, which persists to the cloud BFF over the trusted svc path using a
// per-user run token (auth-bff-api.md §10) — no shared secret needed on the client.
// Execution itself is always local.
import type { RunRepository } from "./run-repository";
import { mongoRunRepository } from "./mongo-run-repository";
import { BffRunRepository } from "./bff-run-repository";
import { getRunGateway } from "@/server/data/run-gateway";

export function getRunRepository(ownerId: string): RunRepository {
  if (process.env.BFF_URL) {
    return new BffRunRepository(getRunGateway(), ownerId);
  }
  return mongoRunRepository;
}
