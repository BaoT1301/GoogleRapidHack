/**
 * Cluster API Client
 *
 * Fetches cluster configuration from the MCP Context Manager.
 * Validates the response with Zod before returning.
 */

import api from "./instance";
import { ClusterConfigSchema, type ClusterConfig } from "../types/globe";

/**
 * Fetch the cluster configuration used for geographic grouping on the globe.
 *
 * @returns Validated ClusterConfig with all cluster definitions
 */
export async function fetchClusters(): Promise<ClusterConfig> {
  const { data } = await api.get("/mcp/clusters");
  return ClusterConfigSchema.parse(data);
}
