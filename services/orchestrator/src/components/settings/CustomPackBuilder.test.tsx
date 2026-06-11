import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { safeParseThemePack } from "@/lib/canvas-theme/schema";
import { buildCustomPack } from "@/lib/canvas-theme/custom";
import { classicPack } from "@/lib/canvas-theme/packs/classic";

const created: { name: string; pack: unknown }[] = [];
const updated: { id: string; name: string; pack: unknown }[] = [];

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    assets: {
      list: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["assets", "list"]],
          queryFn: async () => [
            { id: "a1", name: "hero.png", url: "/api/assets/a1", pixelated: true },
          ],
          ...opts,
        }),
      },
    },
    themePacks: {
      create: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: { name: string; pack: unknown }) => {
            created.push(vars);
            return { ...(vars.pack as object), id: "user_x", name: vars.name };
          },
          ...opts,
        }),
      },
      update: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: { id: string; name: string; pack: unknown }) => {
            updated.push(vars);
            return { ...(vars.pack as object), id: vars.id, name: vars.name };
          },
          ...opts,
        }),
      },
    },
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

import { CustomPackBuilder } from "@/components/settings/CustomPackBuilder";

function renderIt(onCreated = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CustomPackBuilder open onClose={() => {}} userPacks={[]} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

describe("CustomPackBuilder", () => {
  it("creates a valid pack from the chosen base + name", async () => {
    const onCreated = renderIt();
    const nameInput = await screen.findByLabelText("Pack name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Neon");

    await userEvent.click(screen.getByRole("button", { name: "Create pack" }));

    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    const last = created[created.length - 1];
    expect(last.name).toBe("Neon");
    // The assembled pack is a valid ThemePack (full coverage carried from base).
    expect(safeParseThemePack(last.pack).success).toBe(true);
    expect(onCreated).toHaveBeenCalled();
  });

  it("offers imported assets as sprite options", async () => {
    renderIt();
    // The asset name appears in the per-kind sprite selects.
    const options = await screen.findAllByRole("option", { name: "hero.png" });
    expect(options.length).toBeGreaterThan(0);
  });

  it("assigns a per-state sprite (running) + mirrors it onto the runtime alias", async () => {
    const onCreated = renderIt();
    // Wait for the imported assets to load into the sprite selects.
    await screen.findAllByRole("option", { name: "hero.png" });
    const runSprite = screen.getByLabelText("running state sprite");
    await userEvent.selectOptions(runSprite, "/api/assets/a1");

    await userEvent.click(screen.getByRole("button", { name: "Create pack" }));

    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    const last = created[created.length - 1];
    const res = safeParseThemePack(last.pack);
    expect(res.success).toBe(true);
    if (res.success) {
      const pack = res.data;
      expect(pack.statuses.running.assetRef).toBe("status-running");
      // Simple mode mirrors running's look onto its alias `starting`.
      expect(pack.statuses.starting.assetRef).toBe("status-starting");
      expect(pack.assets["status-running"]?.url).toBe("/api/assets/a1");
    }
    expect(onCreated).toHaveBeenCalled();
  });

  it("reveals all 16 states when 'show all states' is toggled on", async () => {
    renderIt();
    // Core mode: a non-core state row is absent.
    expect(screen.queryByLabelText("blocked state sprite")).toBeNull();
    await userEvent.click(screen.getByRole("switch", { name: "Show all states" }));
    expect(await screen.findByLabelText("blocked state sprite")).toBeInTheDocument();
  });

  it("applies background image filters (blur + tint) into the pack", async () => {
    renderIt();
    // Switch the background to image and pick the imported asset.
    await userEvent.selectOptions(
      await screen.findByLabelText("Background"),
      "image",
    );
    await userEvent.selectOptions(
      await screen.findByLabelText("Background image"),
      "/api/assets/a1",
    );

    // Nudge the blur + tint-opacity sliders off their neutral values.
    const blur = screen.getByLabelText("Background blur") as HTMLInputElement;
    fireEvent.change(blur, { target: { value: "8" } });
    const tintOpacity = screen.getByLabelText(
      "Background tint opacity",
    ) as HTMLInputElement;
    fireEvent.change(tintOpacity, { target: { value: "0.5" } });

    await userEvent.click(screen.getByRole("button", { name: "Create pack" }));

    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    const last = created[created.length - 1];
    const res = safeParseThemePack(last.pack);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.background.kind).toBe("image");
      expect(res.data.background.filter?.blur).toBe(8);
      expect(res.data.background.filter?.tintOpacity).toBe(0.5);
      expect(res.data.background.filter?.tintColor).toBeDefined();
    }
  });

  it("edits an existing pack in place via update (preserves id, renames)", async () => {
    const editPack = buildCustomPack(classicPack, {
      name: "Old name",
      basePackId: "classic",
    });
    editPack.id = "user_edit_1"; // simulate the persisted (server-assigned) id

    const onUpdated = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CustomPackBuilder
          open
          onClose={() => {}}
          userPacks={[editPack]}
          onCreated={() => {}}
          onUpdated={onUpdated}
          editPack={editPack}
        />
      </QueryClientProvider>,
    );

    const nameInput = await screen.findByLabelText("Pack name");
    await waitFor(() =>
      expect((nameInput as HTMLInputElement).value).toBe("Old name"),
    );
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "New name");

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updated.length).toBeGreaterThan(0));
    const last = updated[updated.length - 1];
    expect(last.id).toBe("user_edit_1"); // id preserved (in-place edit)
    expect(last.name).toBe("New name");
    expect(safeParseThemePack(last.pack).success).toBe(true);
    expect(onUpdated).toHaveBeenCalled();
  });
});
