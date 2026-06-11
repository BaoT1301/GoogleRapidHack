/**
 * SSE Client
 *
 * Wraps the browser EventSource API with exponential backoff reconnection
 * and typed event handling for file-change events from the MCP Context Manager.
 */

import { FileChangeEventSchema, type FileChangeEvent } from "../types/globe";

type FileChangeCallback = (event: FileChangeEvent) => void;
type ConnectionCallback = () => void;
type IndexingProgressCallback = (current: number, total: number) => void;
type IndexingCompleteCallback = (indexedFiles: number) => void;

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export class SSEClient {
  private url: string;
  private eventSource: EventSource | null = null;
  private retryDelay = INITIAL_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private fileChangeCallbacks: FileChangeCallback[] = [];
  private connectionLostCallbacks: ConnectionCallback[] = [];
  private connectionRestoredCallbacks: ConnectionCallback[] = [];
  private indexingProgressCallbacks: IndexingProgressCallback[] = [];
  private indexingCompleteCallbacks: IndexingCompleteCallback[] = [];

  private wasConnected = false;

  constructor(url = "/api/v1/mcp/events") {
    this.url = url;
    this.connect();
  }

  // ── Public API ──────────────────────────────────────────────────────

  onFileChange(callback: FileChangeCallback): void {
    this.fileChangeCallbacks.push(callback);
  }

  onConnectionLost(callback: ConnectionCallback): void {
    this.connectionLostCallbacks.push(callback);
  }

  onConnectionRestored(callback: ConnectionCallback): void {
    this.connectionRestoredCallbacks.push(callback);
  }

  onIndexingProgress(callback: IndexingProgressCallback): void {
    this.indexingProgressCallbacks.push(callback);
  }

  onIndexingComplete(callback: IndexingCompleteCallback): void {
    this.indexingCompleteCallbacks.push(callback);
  }

  disconnect(): void {
    this.disposed = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  // ── Internal ────────────────────────────────────────────────────────

  private connect(): void {
    if (this.disposed) return;

    this.eventSource = new EventSource(this.url);

    this.eventSource.addEventListener("connected", () => {
      if (this.wasConnected) {
        this.connectionRestoredCallbacks.forEach((cb) => cb());
      }
      this.wasConnected = true;
      this.retryDelay = INITIAL_RETRY_MS;
    });

    this.eventSource.addEventListener("file-change", (event: MessageEvent) => {
      try {
        const parsed: unknown = JSON.parse(event.data as string);
        const validated = FileChangeEventSchema.parse(parsed);
        this.fileChangeCallbacks.forEach((cb) => cb(validated));
      } catch {
        // Silently ignore malformed events
      }
    });

    // keepalive events are handled silently — no action needed
    this.eventSource.addEventListener("keepalive", () => {
      // noop
    });

    this.eventSource.addEventListener("indexing-progress", (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as { current: number; total: number };
        if (typeof parsed.current === "number" && typeof parsed.total === "number") {
          this.indexingProgressCallbacks.forEach((cb) => cb(parsed.current, parsed.total));
        }
      } catch {
        // Silently ignore malformed events
      }
    });

    this.eventSource.addEventListener("indexing-complete", (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as { indexedFiles: number };
        if (typeof parsed.indexedFiles === "number") {
          this.indexingCompleteCallbacks.forEach((cb) => cb(parsed.indexedFiles));
        }
      } catch {
        // Silently ignore malformed events
      }
    });

    this.eventSource.onerror = () => {
      if (this.disposed) return;

      this.eventSource?.close();
      this.eventSource = null;

      if (this.wasConnected) {
        this.connectionLostCallbacks.forEach((cb) => cb());
      }

      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retryDelay);

    // Exponential backoff capped at MAX_RETRY_MS
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
  }
}
