import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let CATALOGS: unknown[];
let SETTINGS: { allowedTools: string[]; allowedToolsByCli: Record<string, string[]> };
let saved: Record<string, unknown> | null;

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    system: {
      cliTools: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["system", "cliTools"]],
          queryFn: async () => CATALOGS,
          ...opts,
        }),
      },
    },
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
            saved = vars;
            SETTINGS = { ...SETTINGS, ...(vars as object) } as typeof SETTINGS;
            return SETTINGS;
          },
          ...opts,
        }),
      },
    },
  }),
}));

import { AllowedToolsEditor } from "@/components/settings/AllowedToolsEditor";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AllowedToolsEditor />
    </QueryClientProvider>,
  );
}

describe("AllowedToolsEditor (per-CLI sections)", () => {
  beforeEach(() => {
    saved = null;
    CATALOGS = [
      {
        cli: "kiro",
        wired: true,
        tools: [
          { name: "fs_read", kind: "read", description: "Read files." },
          { name: "fs_write", kind: "write", description: "Edit files." },
          { name: "execute_bash", kind: "execute", description: "Run shell." },
        ],
        defaultAllowed: ["fs_read"],
        readOnly: ["fs_read"],
        note: "Applied to EXECUTE nodes via kiro --trust-tools.",
      },
      {
        cli: "codex",
        wired: false,
        tools: [
          { name: "read_files", kind: "read", description: "Read files." },
          { name: "edit_files", kind: "write", description: "Edit files." },
        ],
        defaultAllowed: ["read_files"],
        readOnly: ["read_files"],
        note: "Informational for now — selections are saved but not yet enforced.",
      },
    ];
    SETTINGS = {
      allowedTools: ["fs_read"],
      allowedToolsByCli: { kiro: ["fs_read"], codex: ["read_files"] },
    };
  });

  it("renders a section per CLI with a wired/informational badge and note", async () => {
    renderIt();
    expect(await screen.findByRole("heading", { name: "Kiro" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByText("wired")).toBeInTheDocument();
    expect(screen.getByText("informational")).toBeInTheDocument();
    expect(screen.getByText(/Informational for now/)).toBeInTheDocument();
    expect(screen.getByText(/always read-only/)).toBeInTheDocument();
  });

  it("reflects the persisted per-CLI selection and disables Save until dirty", async () => {
    renderIt();
    const kiroRead = (await screen.findByLabelText(/fs_read/)) as HTMLInputElement;
    const codexRead = (await screen.findByLabelText(/read_files/)) as HTMLInputElement;
    await waitFor(() => expect(kiroRead.checked).toBe(true));
    expect(codexRead.checked).toBe(true);
    expect(screen.getByRole("button", { name: /save tools/i })).toBeDisabled();
  });

  it("round-trips the whole per-CLI map through settings.update", async () => {
    renderIt();
    const kiroWrite = (await screen.findByLabelText(/fs_write/)) as HTMLInputElement;
    await userEvent.click(kiroWrite);
    const save = screen.getByRole("button", { name: /save tools/i });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(saved).not.toBeNull());

    const payload = (saved as { allowedToolsByCli: Record<string, string[]> }).allowedToolsByCli;
    expect(payload.kiro.sort()).toEqual(["fs_read", "fs_write"]);
    // Codex selection is included unchanged in the saved map.
    expect(payload.codex).toEqual(["read_files"]);
  });
});
