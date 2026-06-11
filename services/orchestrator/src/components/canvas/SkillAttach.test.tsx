import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let SKILLS: unknown[];

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
    },
  }),
}));

import { SkillAttach } from "@/components/canvas/SkillAttach";

function renderIt(value: string[], onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SkillAttach value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("SkillAttach (SKILL-2)", () => {
  beforeEach(() => {
    SKILLS = [
      { id: "minimalist-ui", name: "Minimalist Ui", source: "x" },
      { id: "high-end-visual-design", name: "High End Visual Design" },
    ];
  });

  it("lists installed skills and reflects the attached set", async () => {
    renderIt(["minimalist-ui"]);
    const box = (await screen.findByLabelText(/Minimalist Ui/)) as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
    const other = screen.getByLabelText(/High End Visual Design/) as HTMLInputElement;
    expect(other.checked).toBe(false);
  });

  it("attaching a skill calls onChange with the new id array", async () => {
    const onChange = renderIt([]);
    const box = await screen.findByLabelText(/Minimalist Ui/);
    await userEvent.click(box);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["minimalist-ui"]));
  });

  it("detaching removes the id", async () => {
    const onChange = renderIt(["minimalist-ui"]);
    const box = await screen.findByLabelText(/Minimalist Ui/);
    await userEvent.click(box);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
  });
});
