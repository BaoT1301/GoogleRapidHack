import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CliAuthBadge } from "@/components/settings/CliAuthBadge";

describe("CliAuthBadge (CLI auth-state UX)", () => {
  it("host-login → 'signed in (host login)', no fix hint", () => {
    render(<CliAuthBadge cli="kiro" authMode="host-login" />);
    expect(screen.getByText("Kiro: signed in (host login)")).toBeInTheDocument();
    expect(screen.queryByText(/kiro-cli login/)).not.toBeInTheDocument();
  });

  it("api-key → 'using API key (fallback)'", () => {
    render(<CliAuthBadge cli="kiro" authMode="api-key" />);
    expect(screen.getByText("Kiro: using API key (fallback)")).toBeInTheDocument();
  });

  it("unauthenticated → 'not signed in' + actionable fix hint", () => {
    render(<CliAuthBadge cli="kiro" authMode="unauthenticated" />);
    expect(screen.getByText("Kiro: not signed in")).toBeInTheDocument();
    expect(screen.getByText(/Run `kiro-cli login` or add KIRO_API_KEY/)).toBeInTheDocument();
  });

  it("never renders a key value", () => {
    const { container } = render(<CliAuthBadge cli="kiro" authMode="api-key" />);
    expect(container.textContent).not.toMatch(/sk-/);
  });
});
