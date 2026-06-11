import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let SKILLS: Array<{ id: string; name: string; source?: string; description?: string }>;
const addImpl = vi.fn();
const removeImpl = vi.fn();
const repinImpl = vi.fn();

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    skills: {
      list: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["skills", "list"]],
          queryFn: async () => SKILLS,
          ...opts,
        }),
      },
      add: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: { source: string; id?: string }) => addImpl(vars),
          ...opts,
        }),
      },
      remove: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: { id: string }) => removeImpl(vars),
          ...opts,
        }),
      },
      repin: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: { id: string }) => repinImpl(vars),
          ...opts,
        }),
      },
    },
  }),
}));

import { SkillRegistry } from "@/components/settings/SkillRegistry";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SkillRegistry />
    </QueryClientProvider>,
  );
}

describe("SkillRegistry (SKILL-INSTALL UI)", () => {
  beforeEach(() => {
    SKILLS = [{ id: "minimalist-ui", name: "Minimalist Ui", source: "Leonxlnx/taste-skill" }];
    addImpl.mockReset();
    removeImpl.mockReset();
    repinImpl.mockReset();
  });

  it("lists installed skills", async () => {
    renderIt();
    expect(await screen.findByText("Minimalist Ui")).toBeInTheDocument();
  });

  it("submits the add form with the typed source and refetches the list", async () => {
    addImpl.mockImplementation((vars: { source: string }) => {
      SKILLS = [
        ...SKILLS,
        { id: "design-taste-frontend", name: "Design Taste Frontend", source: vars.source },
      ];
      return { id: "design-taste-frontend" };
    });
    renderIt();
    await screen.findByText("Minimalist Ui");

    await userEvent.type(
      screen.getByLabelText("Skill source"),
      "Leonxlnx/taste-skill:skills/taste-skill@main",
    );
    await userEvent.click(screen.getByRole("button", { name: /add skill/i }));

    await waitFor(() =>
      expect(addImpl).toHaveBeenCalledWith({
        source: "Leonxlnx/taste-skill:skills/taste-skill@main",
        id: undefined,
        tokenSecretId: undefined,
      }),
    );
    expect(await screen.findByText("Design Taste Frontend")).toBeInTheDocument();
  });

  it("shows an error when the install fails", async () => {
    addImpl.mockRejectedValue(new Error("No installed provider can handle source: bad"));
    renderIt();
    await screen.findByText("Minimalist Ui");
    await userEvent.type(screen.getByLabelText("Skill source"), "bad");
    await userEvent.click(screen.getByRole("button", { name: /add skill/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No installed provider/);
  });

  it("re-pin calls the mutation with the row id", async () => {
    repinImpl.mockResolvedValue({ id: "minimalist-ui" });
    renderIt();
    await screen.findByText("Minimalist Ui");
    await userEvent.click(screen.getByRole("button", { name: /re-pin/i }));
    await waitFor(() => expect(repinImpl).toHaveBeenCalledWith({ id: "minimalist-ui" }));
  });

  it("remove calls the mutation with the row id and refetches", async () => {
    removeImpl.mockImplementation(() => {
      SKILLS = [];
      return { removed: true };
    });
    renderIt();
    await screen.findByText("Minimalist Ui");
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(removeImpl).toHaveBeenCalledWith({ id: "minimalist-ui" }));
    await waitFor(() => expect(screen.queryByText("Minimalist Ui")).not.toBeInTheDocument());
  });

  it("does not submit an empty source", async () => {
    renderIt();
    await screen.findByText("Minimalist Ui");
    const btn = screen.getByRole("button", { name: /add skill/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
