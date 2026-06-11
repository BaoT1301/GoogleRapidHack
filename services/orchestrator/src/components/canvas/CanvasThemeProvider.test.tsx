import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  CanvasThemeProvider,
  useCanvasTheme,
} from "./CanvasThemeProvider";
import { CLASSIC_PACK_ID } from "@/lib/canvas-theme";
import { classicPack } from "@/lib/canvas-theme/packs/classic";

function Probe() {
  const { pack, packId, setPackId, availablePacks } = useCanvasTheme();
  return (
    <div>
      <span data-testid="packId">{packId}</span>
      <span data-testid="packName">{pack.name}</span>
      <span data-testid="count">{availablePacks.length}</span>
      <button onClick={() => setPackId("does-not-exist")}>switch</button>
    </div>
  );
}

describe("CanvasThemeProvider", () => {
  it("defaults to the Classic pack", () => {
    render(
      <CanvasThemeProvider>
        <Probe />
      </CanvasThemeProvider>,
    );
    expect(screen.getByTestId("packId").textContent).toBe(CLASSIC_PACK_ID);
    expect(screen.getByTestId("packName").textContent).toBe("Classic");
    expect(Number(screen.getByTestId("count").textContent)).toBeGreaterThan(0);
  });

  it("honors an initialPackId seed", () => {
    render(
      <CanvasThemeProvider initialPackId={CLASSIC_PACK_ID}>
        <Probe />
      </CanvasThemeProvider>,
    );
    expect(screen.getByTestId("packId").textContent).toBe(CLASSIC_PACK_ID);
  });

  it("falls back to Classic when switched to an unknown pack id", () => {
    render(
      <CanvasThemeProvider>
        <Probe />
      </CanvasThemeProvider>,
    );
    act(() => {
      screen.getByText("switch").click();
    });
    // packId updates, but the resolved pack stays valid (Classic fallback).
    expect(screen.getByTestId("packId").textContent).toBe("does-not-exist");
    expect(screen.getByTestId("packName").textContent).toBe("Classic");
  });

  it("throws if useCanvasTheme is used outside the provider", () => {
    const spy = () => render(<Probe />);
    expect(spy).toThrow(/CanvasThemeProvider/);
  });

  it("resolves a user extraPack by id and lists it alongside built-ins", () => {
    const userPack = { ...classicPack, id: "user_1", name: "My Pack" };
    function Switcher() {
      const { setPackId } = useCanvasTheme();
      return <button onClick={() => setPackId("user_1")}>use-user</button>;
    }
    render(
      <CanvasThemeProvider extraPacks={[userPack]}>
        <Probe />
        <Switcher />
      </CanvasThemeProvider>,
    );
    // User pack appears in the selectable list (built-ins + extras).
    const count = Number(screen.getByTestId("count").textContent);
    expect(count).toBeGreaterThan(1);
    act(() => {
      screen.getByText("use-user").click();
    });
    expect(screen.getByTestId("packId").textContent).toBe("user_1");
    expect(screen.getByTestId("packName").textContent).toBe("My Pack");
  });
});
