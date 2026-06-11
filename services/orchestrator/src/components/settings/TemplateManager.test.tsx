import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Tpl {
  id: string;
  name: string;
  kind: "persona" | "rule";
  source: "default" | "workspace";
  content: string;
  sha: string;
  version: string;
  ownerId?: string;
}

let LIST: Tpl[];
const calls: { create: unknown[]; duplicate: unknown[]; delete: unknown[]; update: unknown[] } = {
  create: [],
  duplicate: [],
  delete: [],
  update: [],
};

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    templates: {
      list: {
        queryOptions: (input: { kind?: string } | undefined, opts: Record<string, unknown> = {}) => ({
          queryKey: [["templates", "list"], input?.kind ?? "all"],
          queryFn: async () =>
            input?.kind ? LIST.filter((t) => t.kind === input.kind) : LIST,
          ...opts,
        }),
      },
      create: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: unknown) => {
            calls.create.push(vars);
            return { id: "x", kind: "persona", source: "workspace" };
          },
          ...opts,
        }),
      },
      duplicate: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: unknown) => {
            calls.duplicate.push(vars);
            return { id: "x_copy", kind: "persona", source: "workspace" };
          },
          ...opts,
        }),
      },
      delete: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: unknown) => {
            calls.delete.push(vars);
            return { deleted: true };
          },
          ...opts,
        }),
      },
      update: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: unknown) => {
            calls.update.push(vars);
            return { id: "y", content: "" };
          },
          ...opts,
        }),
      },
    },
  }),
}));

import { TemplateManager } from "@/components/settings/TemplateManager";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TemplateManager />
    </QueryClientProvider>,
  );
}

describe("TemplateManager (TPL-1/2 UI)", () => {
  beforeEach(() => {
    calls.create = [];
    calls.duplicate = [];
    calls.delete = [];
    calls.update = [];
    LIST = [
      {
        id: "backend_engineer",
        name: "backend engineer",
        kind: "persona",
        source: "default",
        content: "# backend",
        sha: "a",
        version: "default@a",
      },
      {
        id: "my_custom",
        name: "My Custom",
        kind: "persona",
        source: "workspace",
        content: "# mine",
        sha: "b",
        version: "workspace@b",
        ownerId: "me",
      },
    ];
  });

  it("renders defaults and workspace forks with badges", async () => {
    renderIt();
    expect(await screen.findByText("backend engineer")).toBeInTheDocument();
    expect(screen.getByText("My Custom")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Workspace fork")).toBeInTheDocument();
  });

  it("defaults show View (read-only) not Delete; forks show Delete + Edit", async () => {
    renderIt();
    await screen.findByText("backend engineer");
    expect(screen.queryByRole("button", { name: /Delete backend engineer/i })).toBeNull();
    expect(screen.getByRole("button", { name: /View backend engineer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit My Custom/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete My Custom/i })).toBeInTheDocument();
  });

  it("View opens a read-only rendered markdown preview of a default", async () => {
    LIST[0].content = "# Backend Engineer\n\nOwns the **API** layer.";
    renderIt();
    await screen.findByText("backend engineer");
    await userEvent.click(screen.getByRole("button", { name: /View backend engineer/i }));
    const dialog = await screen.findByRole("dialog", { name: /View backend engineer/i });
    // Rendered as markdown (heading + bold), not raw text, and no editor.
    expect(within(dialog).getByRole("heading", { name: "Backend Engineer" })).toBeInTheDocument();
    expect(within(dialog).getByText("API").tagName).toBe("STRONG");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
  });

  it("Edit dialog toggles between edit (textarea) and rendered preview", async () => {
    renderIt();
    await screen.findByText("My Custom");
    await userEvent.click(screen.getByRole("button", { name: /Edit My Custom/i }));
    const dialog = await screen.findByRole("dialog", { name: /Edit My Custom/i });
    // Starts in edit mode with a textarea.
    const textarea = within(dialog).getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("# mine");
    // Switch to preview → rendered heading, no textbox.
    await userEvent.click(within(dialog).getByRole("tab", { name: /preview/i }));
    expect(within(dialog).getByRole("heading", { name: "mine" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
  });

  it("Create blank calls templates.create with the chosen kind + name", async () => {
    renderIt();
    await screen.findByText("backend engineer");
    await userEvent.click(screen.getByRole("button", { name: /Create blank/i }));
    await userEvent.type(screen.getByPlaceholderText("My custom persona"), "Fresh Persona");
    await userEvent.click(screen.getByRole("button", { name: /^Create$/i }));
    await waitFor(() => expect(calls.create.length).toBe(1));
    expect(calls.create[0]).toMatchObject({ kind: "persona", name: "Fresh Persona" });
  });

  it("Duplicate calls templates.duplicate for a default", async () => {
    renderIt();
    await screen.findByText("backend engineer");
    await userEvent.click(screen.getByRole("button", { name: /Duplicate backend engineer/i }));
    await waitFor(() => expect(calls.duplicate.length).toBe(1));
    expect(calls.duplicate[0]).toMatchObject({ id: "backend_engineer", kind: "persona" });
  });

  it("Delete is confirm-gated: only fires after confirming in the dialog", async () => {
    renderIt();
    await screen.findByText("My Custom");
    await userEvent.click(screen.getByRole("button", { name: /Delete My Custom/i }));
    // Dialog open — mutation not yet called.
    const dialog = await screen.findByRole("dialog", { name: /Delete template/i });
    expect(calls.delete.length).toBe(0);
    await userEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(calls.delete.length).toBe(1));
    expect(calls.delete[0]).toMatchObject({ id: "my_custom", kind: "persona" });
  });
});
