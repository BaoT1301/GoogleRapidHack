/**
 * useSSEEvents Hook
 *
 * Manages an SSE connection to the MCP Context Manager for real-time
 * file change notifications. Integrates with sonner for toast messages
 * and React Query for cache invalidation on reconnect.
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SSEClient } from "../api/sse";
import type { FileChangeEvent } from "../types/globe";

interface SSEEventsState {
  lastEvent: FileChangeEvent | null;
  isConnected: boolean;
  indexingProgress: { current: number; total: number } | null;
  indexingComplete: boolean;
}

/**
 * Creates an SSE client on mount, cleans up on unmount.
 * Shows toast notifications for file changes and connection status.
 * Invalidates the mcp-graph query cache on reconnect.
 */
export function useSSEEvents(): SSEEventsState {
  const [lastEvent, setLastEvent] = useState<FileChangeEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState<{ current: number; total: number } | null>(null);
  const [indexingComplete, setIndexingComplete] = useState(false);
  const queryClient = useQueryClient();
  const clientRef = useRef<SSEClient | null>(null);

  useEffect(() => {
    const client = new SSEClient();
    clientRef.current = client;

    client.onFileChange((event) => {
      setLastEvent(event);

      const filename = event.filePath ?? event.filePaths?.[0] ?? "unknown";
      const shortName = filename.split("/").pop() ?? filename;

      if (event.type === "file-updated") {
        toast(`File updated: ${shortName}`, { duration: 3000 });
      } else if (event.type === "file-deleted") {
        toast(`File deleted: ${shortName}`, { duration: 3000 });
      } else if (event.type === "file-created") {
        toast(`File created: ${shortName}`, { duration: 3000 });
      }
    });

    client.onConnectionLost(() => {
      setIsConnected(false);
      toast.error("Connection lost. Reconnecting...", { duration: 5000 });
    });

    client.onConnectionRestored(() => {
      setIsConnected(true);
      toast.success("Connection restored", { duration: 3000 });
      // Invalidate graph cache so the globe picks up any changes that happened while disconnected
      queryClient.invalidateQueries({ queryKey: ["mcp-graph"] });
    });

    client.onIndexingProgress((current, total) => {
      setIndexingProgress({ current, total });
    });

    client.onIndexingComplete(() => {
      setIndexingComplete(true);
    });

    // Mark connected once the client is created (actual connection confirmed via SSE "connected" event)
    setIsConnected(true);

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [queryClient]);

  return { lastEvent, isConnected, indexingProgress, indexingComplete };
}
