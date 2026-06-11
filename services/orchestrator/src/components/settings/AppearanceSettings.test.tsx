import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let SETTINGS: {
  canvasThemePackId?: string | null;
  canvasConfig?: { motionEnabled?: boolean; backgroundKind?: string };
};

let USER_PACKS: unknown[] = [];

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    settings: {
      get: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["settings", "get"]],
          queryFn: async () => SETTINGS,
          ...opts,
        }),
      },
      update: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: Record<string, unknown>) => {
            const next = { ...SETTINGS } as typeof SETTINGS;
            if ("canvasThemePackId" in vars)
              next.canvasThemePackId = vars.canvasThemePackId as string;
            if ("canvasConfig" in vars)
              next.canvasConfig = {
                ...next.canvasConfig,
                ...(vars.canvasConfig as object),
              };
            SETTINGS = next;
            return SETTINGS;
          },
          ...opts,
        }),
      },
    },
    themePacks: {
      list: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["themePacks", "list"]],
          queryFn: async () => USER_PACKS,
          ...opts,
        }),
      },
      create: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: unknown) => vars,
          ...opts,
        }),
      },
      update: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: unknown) => vars,
          ...opts,
        }),
      },
      remove: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async () => ({ deleted: true }),
          ...opts,
        }),
      },
    },
    assets: {
      list: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["assets", "list"]],
          queryFn: async () => [],
          ...opts,
        }),
      },
    },
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { buildCustomPack } from "@/lib/canvas-theme/custom";
import { classicPack } from "@/lib/canvas-theme/packs/classic";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AppearanceSettings />
    </QueryClientProvider>,
  );
}

describe("AppearanceSettings", () => {
  beforeEach(() => {
    SETTINGS = {};
    USER_PACKS = [];
  });

  it("defaults to the Classic pack and motion on", async () => {
    renderIt();
    const classic = await screen.findByRole("radio", { name: /Classic/ });
    await waitFor(() => expect(classic).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch", { name: /Canvas motion/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("persists a motion toggle", async () => {
    renderIt();
    const sw = await screen.findByRole("switch", { name: /Canvas motion/ });
    await userEvent.click(sw);
    await waitFor(() =>
      expect(SETTINGS.canvasConfig?.motionEnabled).toBe(false),
    );
  });

  it("persists a background choice", async () => {
    renderIt();
    const lines = await screen.findByRole("radio", { name: "Lines" });
    await userEvent.click(lines);
    await waitFor(() =>
      expect(SETTINGS.canvasConfig?.backgroundKind).toBe("lines"),
    );
  });

  it("opens the custom pack builder", async () => {
    renderIt();
    const openBtn = await screen.findByRole("button", {
      name: /Create custom pack/,
    });
    await userEvent.click(openBtn);
    // The builder dialog exposes a submit button distinct from the opener.
    expect(
      await screen.findByRole("button", { name: "Create pack" }),
    ).toBeInTheDocument();
  });

  it("edits an existing custom pack via its Edit button", async () => {
    const pack = buildCustomPack(classicPack, {
      name: "Mine",
      basePackId: "classic",
    });
    pack.id = "cp1";
    USER_PACKS = [pack];

    renderIt();
    const editBtn = await screen.findByRole("button", { name: "Edit Mine" });
    await userEvent.click(editBtn);
    // Opens the builder in edit mode (distinct title + submit label).
    expect(
      await screen.findByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("customizes a built-in pack (forks into the create builder)", async () => {
    renderIt();
    const customizeBtn = await screen.findByRole("button", {
      name: "Customize Classic",
    });
    await userEvent.click(customizeBtn);
    expect(
      await screen.findByRole("button", { name: "Create pack" }),
    ).toBeInTheDocument();
  });
});
