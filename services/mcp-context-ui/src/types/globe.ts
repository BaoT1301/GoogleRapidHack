/**
 * Globe Visualization Type Definitions
 *
 * Zod schemas and TypeScript types for the 3D globe visualization layer.
 * These types extend the base MCP graph types with geographic coordinates
 * and visual styling information.
 */

import { z } from "zod";
import { EdgeSchema } from "./mcp";

// ---------------------------------------------------------------------------
// Re-export EdgeType from the existing schema
// ---------------------------------------------------------------------------
export type EdgeType = z.infer<typeof EdgeSchema>["type"];

// ---------------------------------------------------------------------------
// Arc styling constants — one entry per EdgeType
// ---------------------------------------------------------------------------
interface ArcStyle {
  color: string;
  dashLength: number;
  dashGap: number;
}

export const ARC_STYLES: Record<EdgeType, ArcStyle> = {
  imports:      { color: "#4A90E2", dashLength: 1.0, dashGap: 0 },
  calls:        { color: "#E2904A", dashLength: 1.0, dashGap: 0 },
  defines:      { color: "#90E24A", dashLength: 1.0, dashGap: 0 },
  reads:        { color: "#E24A90", dashLength: 1.0, dashGap: 0 },
  writes:       { color: "#904AE2", dashLength: 1.0, dashGap: 0 },
  references:   { color: "#4AE290", dashLength: 1.0, dashGap: 0 },
  instantiates: { color: "#EC4899", dashLength: 1.0, dashGap: 0 },
  exports:      { color: "#14B8A6", dashLength: 1.0, dashGap: 0 },
  inherits:     { color: "#F59E0B", dashLength: 1.0, dashGap: 0 },
};

// ---------------------------------------------------------------------------
// FunctionLabel
// ---------------------------------------------------------------------------
export const FunctionLabelSchema = z.object({
  name: z.string(),
  signature: z.string(),
  type: z.enum(["function", "class"]),
});

export type FunctionLabel = z.infer<typeof FunctionLabelSchema>;

// ---------------------------------------------------------------------------
// GlobeNode — a file rendered as a point on the globe
// ---------------------------------------------------------------------------
export const GlobeNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
  altitude: z.number(),
  color: z.string(),
  clusterId: z.string(),
  functions: z.array(FunctionLabelSchema),
});

export type GlobeNode = z.infer<typeof GlobeNodeSchema>;

// ---------------------------------------------------------------------------
// GlobeArc — a dependency rendered as a flying arc
// ---------------------------------------------------------------------------
export const GlobeArcSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: EdgeSchema.shape.type,
  color: z.string(),
  dashLength: z.number(),
  dashGap: z.number(),
  altitude: z.number(),
  animated: z.boolean(),
});

export type GlobeArc = z.infer<typeof GlobeArcSchema>;

// ---------------------------------------------------------------------------
// Cluster configuration (from /api/mcp/clusters)
// ---------------------------------------------------------------------------
export const ClusterSchema = z.object({
  id: z.string().min(1),
  path: z.string(),
  label: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export type Cluster = z.infer<typeof ClusterSchema>;

export const ClusterConfigSchema = z.object({
  clusters: z.array(ClusterSchema),
});

export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;

// ---------------------------------------------------------------------------
// SSE FileChangeEvent
// ---------------------------------------------------------------------------
export const FileChangeEventSchema = z.object({
  type: z.enum(["file-created", "file-updated", "file-deleted"]),
  filePath: z.string().optional(),
  filePaths: z.array(z.string()).optional(),
  clusterId: z.string().optional(),
  clusterIds: z.array(z.string()).optional(),
  timestamp: z.number(),
});

export type FileChangeEvent = z.infer<typeof FileChangeEventSchema>;
