/**
 * Client-safe status → colour map. Covers the graph.model `NodeStatus` /
 * `GraphStatus` enums AND the SSE runtime contract states (starting/cancelled/
 * completed) so the canvas, dashboard, and run viewer share one palette.
 * No mongoose import here — safe for the client bundle.
 */
export const STATUS_COLORS: Record<string, string> = {
  // node (graph.model) + runtime contract
  pending: "#646b7a",
  ready: "#4f9be0",
  queued: "#646b7a",
  starting: "#d8a72b",
  running: "#d8a72b",
  paused: "#9a86ff",
  success: "#46b85f",
  completed: "#46b85f",
  failed: "#ef6b5c",
  cancelled: "#8b6f9c",
  skipped: "#6b7280",
  blocked: "#d8803f",
  // graph
  draft: "#646b7a",
  archived: "#6b7280",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "#646b7a";
}
