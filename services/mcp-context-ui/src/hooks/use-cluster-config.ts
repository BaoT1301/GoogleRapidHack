/**
 * useClusterConfig Hook
 *
 * React Query hook for fetching cluster configuration from the backend.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchClusters } from "../api/clusters";

/**
 * Fetch and cache the cluster configuration.
 * Clusters rarely change, so staleTime is set to 60 seconds.
 */
export function useClusterConfig() {
  return useQuery({
    queryKey: ["mcp-clusters"],
    queryFn: fetchClusters,
    staleTime: 60_000,
    retry: 2,
  });
}
