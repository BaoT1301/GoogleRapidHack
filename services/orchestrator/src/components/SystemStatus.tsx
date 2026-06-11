"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "ok" | "down";

const dotStyle = (s: Status): React.CSSProperties => ({
  display: "inline-block",
  width: 10,
  height: 10,
  borderRadius: "50%",
  flexShrink: 0,
  background:
    s === "ok"
      ? "var(--success)"
      : s === "down"
        ? "var(--danger)"
        : "var(--warning)",
  boxShadow:
    s === "ok"
      ? "0 0 8px color-mix(in oklab, var(--success) 50%, transparent)"
      : undefined,
});

const cardStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 200,
  padding: 16,
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "var(--panel-raised)",
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const label = (s: Status) =>
  s === "ok" ? "Online" : s === "down" ? "Offline" : "Checking…";

export function SystemStatus() {
  const [api, setApi] = useState<Status>("checking");
  const [db, setDb] = useState<Status>("checking");

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const h = await fetch("/api/health", { cache: "no-store" });
        if (alive) setApi(h.ok ? "ok" : "down");
      } catch {
        if (alive) setApi("down");
      }
      try {
        const r = await fetch("/api/ready", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (alive) setDb(j?.checks?.mongo ? "ok" : "down");
      } catch {
        if (alive) setDb("down");
      }
    };
    run();
    const id = setInterval(run, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section
      style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap" }}
    >
      <div style={cardStyle}>
        <span style={dotStyle(api)} />
        <div>
          <div style={{ fontWeight: 600 }}>API server</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{label(api)}</div>
        </div>
      </div>
      <div style={cardStyle}>
        <span style={dotStyle(db)} />
        <div>
          <div style={{ fontWeight: 600 }}>MongoDB</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{label(db)}</div>
        </div>
      </div>
      <div style={cardStyle}>
        <span style={dotStyle("ok")} />
        <div>
          <div style={{ fontWeight: 600 }}>Auth (Clerk)</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Configured</div>
        </div>
      </div>
    </section>
  );
}
