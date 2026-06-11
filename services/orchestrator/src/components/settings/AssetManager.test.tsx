import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Asset {
  id: string;
  name: string;
  contentType: string;
  size: number;
  pixelated?: boolean;
  url: string;
}
let ASSETS: Asset[];

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    assets: {
      list: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["assets", "list"]],
          queryFn: async () => ASSETS,
          ...opts,
        }),
      },
      upload: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: {
            name: string;
            contentType: string;
            dataBase64: string;
            pixelated?: boolean;
          }) => {
            const a: Asset = {
              id: `id_${ASSETS.length + 1}`,
              name: vars.name,
              contentType: vars.contentType,
              size: vars.dataBase64.length,
              pixelated: vars.pixelated,
              url: `/api/assets/id_${ASSETS.length + 1}`,
            };
            ASSETS = [a, ...ASSETS];
            return a;
          },
          ...opts,
        }),
      },
      remove: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: { id: string }) => {
            ASSETS = ASSETS.filter((x) => x.id !== vars.id);
            return { deleted: true };
          },
          ...opts,
        }),
      },
    },
  }),
}));

// Toast is a no-op provider for the test.
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

import { AssetManager } from "@/components/settings/AssetManager";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AssetManager />
    </QueryClientProvider>,
  );
}

describe("AssetManager", () => {
  beforeEach(() => {
    ASSETS = [];
  });

  it("shows the empty state with import guidance", async () => {
    renderIt();
    expect(await screen.findByText(/No assets yet/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Import/ }),
    ).toBeInTheDocument();
  });

  it("uploads a picked PNG and lists it", async () => {
    renderIt();
    await screen.findByText(/No assets yet/);
    const input = screen.getByLabelText("Import asset file") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3, 4])], "sprite.png", {
      type: "image/png",
    });
    await userEvent.upload(input, file);
    expect(await screen.findByText("sprite.png")).toBeInTheDocument();
  });

  it("rejects an unsupported file type without uploading", async () => {
    renderIt();
    await screen.findByText(/No assets yet/);
    const input = screen.getByLabelText("Import asset file") as HTMLInputElement;
    const bad = new File(["x"], "notes.txt", { type: "text/plain" });
    await userEvent.upload(input, bad);
    // Still empty — the unsupported type was blocked client-side.
    expect(screen.getByText(/No assets yet/)).toBeInTheDocument();
  });

  it("deletes an existing asset", async () => {
    ASSETS = [
      {
        id: "id_1",
        name: "tile.png",
        contentType: "image/png",
        size: 100,
        url: "/api/assets/id_1",
      },
    ];
    renderIt();
    const del = await screen.findByRole("button", { name: /Delete tile.png/ });
    await userEvent.click(del);
    await waitFor(() =>
      expect(screen.queryByText("tile.png")).not.toBeInTheDocument(),
    );
  });
});
