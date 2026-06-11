import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const createSpy = vi.fn(async (input: { label: string; value: string }) => ({
  id: "s1",
  label: input.label,
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    secrets: {
      create: {
        mutationOptions: (o: Record<string, unknown> = {}) => ({
          mutationFn: createSpy,
          ...o,
        }),
      },
    },
  }),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { SetupWizard } from "@/components/setup/SetupWizard";

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <SetupWizard open onClose={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("SetupWizard", () => {
  it("stores an API key via secrets.create with the right label and never echoes the raw value", async () => {
    const user = userEvent.setup();
    renderWizard();

    // Step 0 (repo) → Step 1 (passphrase) → Step 2 (API keys).
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    const SECRET = "sk-super-secret-value";
    await user.type(screen.getByPlaceholderText("ANTHROPIC_API_KEY"), "ANTHROPIC_API_KEY");
    await user.type(screen.getByPlaceholderText("sk-…"), SECRET);
    await user.click(screen.getByRole("button", { name: /add key/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0][0]).toEqual({
      label: "ANTHROPIC_API_KEY",
      value: SECRET,
    });

    // The saved label is surfaced…
    expect(await screen.findByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
    // …but the raw secret value is cleared and never rendered back as text.
    expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });
});
