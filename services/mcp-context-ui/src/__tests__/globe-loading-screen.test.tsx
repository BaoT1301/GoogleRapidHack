/**
 * GlobeLoadingScreen Tests
 *
 * Verifies the two rendering modes:
 *   - Determinate: With `current` and `total` props → static bar with correct width.
 *   - Indeterminate: Without progress props → pulsing bar fallback.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobeLoadingScreen } from "../components/mcp/GlobeLoadingScreen";

describe("GlobeLoadingScreen", () => {
  describe("determinate progress bar", () => {
    it("renders a bar with correct width when current and total are provided", () => {
      const { container } = render(
        <GlobeLoadingScreen isLoading={true} current={50} total={200} />,
      );

      // Should show "Indexing files... 50/200"
      expect(screen.getByText("Indexing files... 50/200")).toBeTruthy();

      // The determinate bar should have width 25% (50/200 = 25%)
      const progressBar = container.querySelector(
        ".bg-blue-500.transition-all",
      ) as HTMLElement;
      expect(progressBar).toBeTruthy();
      expect(progressBar.style.width).toBe("25%");

      // Should NOT have animate-pulse class (determinate mode)
      expect(progressBar.classList.contains("animate-pulse")).toBe(false);
    });

    it("renders 100% width when current equals total", () => {
      const { container } = render(
        <GlobeLoadingScreen isLoading={true} current={100} total={100} />,
      );

      expect(screen.getByText("Indexing files... 100/100")).toBeTruthy();

      const progressBar = container.querySelector(
        ".bg-blue-500.transition-all",
      ) as HTMLElement;
      expect(progressBar).toBeTruthy();
      expect(progressBar.style.width).toBe("100%");
    });

    it("renders 0% width when current is 0", () => {
      const { container } = render(
        <GlobeLoadingScreen isLoading={true} current={0} total={50} />,
      );

      expect(screen.getByText("Indexing files... 0/50")).toBeTruthy();

      const progressBar = container.querySelector(
        ".bg-blue-500.transition-all",
      ) as HTMLElement;
      expect(progressBar).toBeTruthy();
      expect(progressBar.style.width).toBe("0%");
    });
  });

  describe("indeterminate progress bar", () => {
    it("renders pulsing bar when current and total are not provided", () => {
      const { container } = render(
        <GlobeLoadingScreen isLoading={true} />,
      );

      // Should show generic text without progress numbers
      expect(screen.getByText("Indexing files...")).toBeTruthy();

      // The indeterminate bar should have animate-pulse class
      const progressBar = container.querySelector(
        ".bg-blue-500.animate-pulse",
      ) as HTMLElement;
      expect(progressBar).toBeTruthy();
      expect(progressBar.style.width).toBe("60%");
    });

    it("renders pulsing bar when total is 0", () => {
      const { container } = render(
        <GlobeLoadingScreen isLoading={true} current={0} total={0} />,
      );

      // total=0 means no determinate progress — falls back to indeterminate
      expect(screen.getByText("Indexing files...")).toBeTruthy();

      const progressBar = container.querySelector(
        ".bg-blue-500.animate-pulse",
      ) as HTMLElement;
      expect(progressBar).toBeTruthy();
    });
  });

  describe("visibility", () => {
    it("is visible when isLoading is true", () => {
      const { container } = render(
        <GlobeLoadingScreen isLoading={true} />,
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.opacity).toBe("1");
      expect(wrapper.style.pointerEvents).toBe("auto");
    });

    it("is hidden when isLoading is false", () => {
      const { container } = render(
        <GlobeLoadingScreen isLoading={false} />,
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.opacity).toBe("0");
      expect(wrapper.style.pointerEvents).toBe("none");
    });
  });
});
