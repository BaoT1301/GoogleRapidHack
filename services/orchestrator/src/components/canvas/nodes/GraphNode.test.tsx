import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GraphNodeBody } from "@/components/canvas/nodes/GraphNode";
import { CanvasThemeProvider } from "@/components/canvas/CanvasThemeProvider";
import type { FlowNodeData } from "@/components/canvas/serialize";
import { classicPack } from "@/lib/canvas-theme/packs/classic";
import { parseThemePack } from "@/lib/canvas-theme/schema";

function renderNode(data: FlowNodeData, props: { visualStatus?: never } = {}) {
  return render(
    <CanvasThemeProvider>
      <GraphNodeBody data={data} {...props} />
    </CanvasThemeProvider>,
  );
}

describe("GraphNodeBody (theme-pack driven)", () => {
  it("renders the label, kind, and a status indicator from the active pack", () => {
    renderNode({
      kind: "execute",
      label: "Build the API",
      status: "running",
      data: {},
    });
    expect(screen.getByText("Build the API")).toBeInTheDocument();
    // Kind label comes from the pack, not a hardcoded constant.
    expect(screen.getByText(classicPack.kinds.execute.label)).toBeInTheDocument();
    expect(screen.getByLabelText("status: running")).toBeInTheDocument();
  });

  it("colours the status indicator with the pack's status color", () => {
    renderNode({ kind: "plan", label: "n", status: "success", data: {} });
    const dot = screen.getByLabelText("status: success");
    expect(dot).toHaveStyle({
      backgroundColor: classicPack.statuses.success.color,
    });
  });

  it("reflects live run statuses on the canvas (success / skipped)", () => {
    const { rerender } = renderNode({
      kind: "execute",
      label: "n",
      status: "success",
      data: {},
    });
    expect(screen.getByLabelText("status: success")).toBeInTheDocument();

    rerender(
      <CanvasThemeProvider>
        <GraphNodeBody
          data={{ kind: "gate", label: "g", status: "skipped", data: {} }}
        />
      </CanvasThemeProvider>,
    );
    expect(screen.getByLabelText("status: skipped")).toBeInTheDocument();
  });

  it("honors a UI-derived visualStatus override (stale) without a real status", () => {
    render(
      <CanvasThemeProvider>
        <GraphNodeBody
          data={{ kind: "execute", label: "n", status: "success", data: {} }}
          visualStatus="stale"
        />
      </CanvasThemeProvider>,
    );
    // Stale uses a label override + a ring indicator, not the raw status word.
    expect(
      screen.getByLabelText(`status: ${classicPack.statuses.stale.label}`),
    ).toBeInTheDocument();
  });

  it("renders a pixelated sprite (not the vector icon) for an asset-backed kind", () => {
    const pixelPack = parseThemePack({
      ...classicPack,
      renderMode: "pixel",
      assets: { "node-execute": { url: "/api/assets/abc", pixelated: true } },
      kinds: {
        ...classicPack.kinds,
        execute: { ...classicPack.kinds.execute, assetRef: "node-execute" },
      },
    });
    render(
      <CanvasThemeProvider>
        <GraphNodeBody
          pack={pixelPack}
          data={{ kind: "execute", label: "Sprite node", status: "pending", data: {} }}
        />
      </CanvasThemeProvider>,
    );
    const img = screen.getByRole("img", { name: classicPack.kinds.execute.label });
    expect(img).toHaveAttribute("src", "/api/assets/abc");
    expect(img).toHaveStyle({ imageRendering: "pixelated" });
  });

  it("renders a per-state overlay sprite (gif) in place of the status dot", () => {
    const statePack = parseThemePack({
      ...classicPack,
      assets: { "status-running": { url: "/api/assets/run.gif" } },
      statuses: {
        ...classicPack.statuses,
        running: { ...classicPack.statuses.running, assetRef: "status-running" },
      },
    });
    render(
      <CanvasThemeProvider>
        <GraphNodeBody
          pack={statePack}
          data={{ kind: "execute", label: "Running node", status: "running", data: {} }}
        />
      </CanvasThemeProvider>,
    );
    const img = screen.getByRole("img", { name: "status: running" });
    expect(img).toHaveAttribute("src", "/api/assets/run.gif");
    // The plain dot is replaced by the sprite (no bg-color dot span for status).
    expect(screen.getByLabelText("status: running").tagName).toBe("IMG");
  });

  it("keeps the dot indicator for statuses without an overlay sprite", () => {
    const statePack = parseThemePack({
      ...classicPack,
      assets: { "status-running": { url: "/api/assets/run.gif" } },
      statuses: {
        ...classicPack.statuses,
        running: { ...classicPack.statuses.running, assetRef: "status-running" },
      },
    });
    render(
      <CanvasThemeProvider>
        <GraphNodeBody
          pack={statePack}
          data={{ kind: "execute", label: "Done node", status: "success", data: {} }}
        />
      </CanvasThemeProvider>,
    );
    // success has no sprite → still a dot span.
    expect(screen.getByLabelText("status: success").tagName).toBe("SPAN");
  });

  it("adds explicit hover glow without requiring selection", () => {
    const { container } = render(
      <CanvasThemeProvider>
        <GraphNodeBody
          data={{ kind: "execute", label: "n", status: "pending", data: {}, hovered: true }}
          selected={false}
        />
      </CanvasThemeProvider>,
    );
    expect(container.firstElementChild?.className).toContain("shadow-[0_0_0_1px");
  });

  it("adds a stronger glow for selected/lassoed nodes", () => {
    const { container } = render(
      <CanvasThemeProvider>
        <GraphNodeBody
          data={{ kind: "execute", label: "n", status: "pending", data: {} }}
          selected
        />
      </CanvasThemeProvider>,
    );
    expect(container.firstElementChild?.className).toContain("border-accent");
    expect(container.firstElementChild?.className).toContain("0_0_30px");
  });

  it("renders the live per-node runtime label when provided by the run stream", () => {
    renderNode({
      kind: "execute",
      label: "Timed node",
      status: "running",
      data: {},
      runtimeLabel: "1:05",
    });
    expect(screen.getByLabelText("runtime 1:05")).toBeInTheDocument();
  });
});
