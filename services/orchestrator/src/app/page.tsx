import { SystemStatus } from "@/components/SystemStatus";

// Landing / status screen (app shell — Bao's lane). The node canvas + live agent
// terminals are LA's lane and load at /dashboard (in development).
const STACK = [
  "Next.js 15 (App Router)",
  "tRPC v11",
  "Clerk auth",
  "MongoDB + Mongoose",
  "Electron desktop",
  "Vertex AI / Gemini (Architect API)",
  "MCP (MongoDB · Phoenix)",
];

const badge: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid var(--border-strong)",
  borderRadius: 999,
  fontSize: 13,
  background: "var(--panel-raised)",
};

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--surface)",
        color: "var(--content)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "48px 28px" }}>
        <header>
          <div>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 800 }}>
              AI Workflow Orchestrator
            </h1>
            <p style={{ margin: "8px 0 0", color: "var(--muted)", maxWidth: 620 }}>
              ComfyUI for AI software engineering — draw a graph, press Run, and
              orchestrate real coding agents in isolated git worktrees.
            </p>
          </div>
        </header>

        <SystemStatus />

        <section style={{ marginTop: 32 }}>
          <h2
            style={{
              fontSize: 13,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Tech stack
          </h2>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}
          >
            {STACK.map((s) => (
              <span key={s} style={badge}>
                {s}
              </span>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2
            style={{
              fontSize: 13,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Sponsor integrations
          </h2>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}
          >
            <span style={badge}>MongoDB MCP ✓ live</span>
            <span style={badge}>Arize Phoenix ✓ live</span>
            <span style={badge}>Dynatrace ✓ configured</span>
            <span style={{ ...badge, opacity: 0.55 }}>GitLab — later</span>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <a
            href="/dashboard/debug-run"
            style={{
              display: "inline-block",
              padding: "12px 20px",
              borderRadius: 12,
              background: "var(--success)",
              color: "white",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            ▶ Debug Run — run a real agent &amp; watch live logs
          </a>
          <span style={{ marginLeft: 12, color: "var(--muted)", fontSize: 13 }}>
            (sign in first; spawns a CLI agent in an isolated git worktree)
          </span>
        </section>

        <p style={{ marginTop: 40, color: "var(--muted)", fontSize: 13 }}>
          The node canvas &amp; live agent terminals load at{" "}
          <code style={{ color: "var(--content)" }}>/dashboard</code> (in active
          development). Backend:{" "}
          <a style={{ color: "var(--accent)" }} href="/api/health">
            /api/health
          </a>{" "}
          ·{" "}
          <a style={{ color: "var(--accent)" }} href="/api/ready">
            /api/ready
          </a>
        </p>
      </div>
    </main>
  );
}
