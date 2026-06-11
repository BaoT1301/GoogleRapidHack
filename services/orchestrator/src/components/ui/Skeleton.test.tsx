import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

describe("Skeleton", () => {
  it("renders a decorative, aria-hidden pulsing block with the given classes", () => {
    render(<Skeleton className="h-4 w-24" />);
    const el = screen.getByTestId("skeleton");
    expect(el).toHaveAttribute("aria-hidden");
    expect(el).toHaveAttribute("role", "presentation");
    expect(el).toHaveClass("animate-pulse");
    // Motion-reduce guard so the pulse collapses under reduced motion.
    expect(el).toHaveClass("motion-reduce:animate-none");
    expect(el).toHaveClass("h-4", "w-24");
  });

  it("applies the requested corner radius", () => {
    render(<Skeleton rounded="full" className="h-2 w-2" />);
    expect(screen.getByTestId("skeleton")).toHaveClass("rounded-full");
  });

  it("SkeletonText renders the requested number of lines (last one shortened)", () => {
    render(<SkeletonText lines={4} />);
    const lines = screen.getAllByTestId("skeleton");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toHaveClass("w-2/3");
    expect(lines[0]).toHaveClass("w-full");
  });
});
