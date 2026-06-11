"use client";

// Interactive shell into a node's git worktree. Bridges an xterm.js terminal to
// the authenticated PTY WebSocket server (see src/instrumentation.ts):
//   • keystrokes → { type: "data" } frames
//   • terminal resize → { type: "resize", cols, rows } frames
//   • server { type: "data" } frames → written to the terminal
//   • server { type: "exit" | "error" } → surfaced in the status line
//
// SECURITY: this is a live shell on the host machine. Its raw byte stream is NOT
// secret-redacted (unlike persisted run events), hence the persistent warning
// banner. The connection is owner-scoped + origin-checked server-side.
import { useCallback, useEffect, useRef, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { XtermView, type XtermHandle } from "@/components/run/XtermView";

type ConnState = "connecting" | "open" | "closed" | "error";

// Same host as the page, dedicated PTY port (separate ws server — Next route
// handlers can't upgrade). Cookies are host-scoped so the Clerk session rides
// along across ports.
function wsUrl(runId: string, nodeId: string): string {
  const port = process.env.NEXT_PUBLIC_ORCH_PTY_WS_PORT ?? "3031";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const qs = `runId=${encodeURIComponent(runId)}&nodeId=${encodeURIComponent(nodeId)}`;
  return `${proto}://${host}:${port}/pty?${qs}`;
}

export function InteractiveTerminal({
  runId,
  nodeId,
  worktreePath,
}: {
  runId: string;
  nodeId: string;
  worktreePath?: string;
}) {
  const termRef = useRef<XtermHandle>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sizeRef = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
  const [conn, setConn] = useState<ConnState>("connecting");
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // Open the socket once the component mounts (lazy — only when the Shell tab is
  // shown, because RunTerminal only renders this on the active "shell" tab).
  useEffect(() => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(runId, nodeId));
    } catch {
      setConn("error");
      setStatusLine("Failed to open shell connection.");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConn("open");
      setStatusLine(null);
      send({ type: "init", cols: sizeRef.current.cols, rows: sizeRef.current.rows });
      termRef.current?.focus();
    };
    ws.onmessage = (e) => {
      let msg: { type?: string; data?: string; code?: number; message?: string };
      try {
        msg = JSON.parse(typeof e.data === "string" ? e.data : "");
      } catch {
        return;
      }
      if (msg.type === "data" && typeof msg.data === "string") {
        termRef.current?.write(msg.data);
      } else if (msg.type === "exit") {
        setStatusLine(`Shell exited (code ${msg.code ?? "?"}).`);
      } else if (msg.type === "error") {
        setStatusLine(msg.message ?? "Shell error.");
      }
    };
    ws.onerror = () => {
      setConn("error");
      setStatusLine("Shell connection error.");
    };
    ws.onclose = () => {
      setConn((c) => (c === "error" ? c : "closed"));
      setStatusLine((s) => s ?? "Shell session ended.");
    };

    return () => {
      wsRef.current = null;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    };
  }, [runId, nodeId, send]);

  const onData = useCallback(
    (data: string) => send({ type: "data", data }),
    [send],
  );
  const onResize = useCallback(
    (size: { cols: number; rows: number }) => {
      sizeRef.current = size;
      send({ type: "resize", cols: size.cols, rows: size.rows });
    },
    [send],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-border bg-warning/10 px-3 py-1 text-[10px] text-warning">
        <WarningIcon size={12} weight="fill" />
        <span>
          Live host shell{worktreePath ? ` · ${worktreePath}` : ""} — output is not
          secret-redacted.
        </span>
        <span className="ml-auto uppercase tracking-wide text-faint">{conn}</span>
      </div>
      <XtermView
        ref={termRef}
        readOnly={false}
        onData={onData}
        onResize={onResize}
        className="min-h-0 flex-1 p-2"
      />
      {statusLine && (
        <p className="border-t border-border px-3 py-1 font-mono text-[10px] text-faint">
          {statusLine}
        </p>
      )}
    </div>
  );
}
