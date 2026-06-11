import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown, sanitizeHref } from "@/components/ui/Markdown";

describe("Markdown renderer", () => {
  it("renders headings at the right level", () => {
    render(<Markdown source={"# Title\n## Subtitle"} />);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Subtitle" })).toBeInTheDocument();
  });

  it("renders bold, italic, and inline code", () => {
    const { container } = render(
      <Markdown source={"Some **bold** and *italic* and `code` here."} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("renders fenced code blocks verbatim", () => {
    const src = "```\nconst x = 1;\nconsole.log(x);\n```";
    const { container } = render(<Markdown source={src} />);
    const pre = container.querySelector("pre code");
    expect(pre?.textContent).toBe("const x = 1;\nconsole.log(x);");
  });

  it("renders unordered and ordered lists", () => {
    render(<Markdown source={"- one\n- two\n\n1. first\n2. second"} />);
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("renders safe links and opens them in a new tab", () => {
    render(<Markdown source={"See [docs](https://example.com/x)."} />);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("neutralizes javascript: links (renders text, not an anchor)", () => {
    render(<Markdown source={"Click [here](javascript:alert(1))."} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/here/)).toBeInTheDocument();
  });

  it("escapes raw HTML instead of injecting it", () => {
    const { container } = render(
      <Markdown source={"<script>alert('xss')</script> and <b>not bold</b>"} />,
    );
    // No actual script/bold elements were created from the source.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    // The angle brackets survive as literal text.
    expect(container.textContent).toContain("<script>");
    expect(container.textContent).toContain("<b>not bold</b>");
  });

  it("sanitizeHref allows safe schemes and blocks script schemes", () => {
    expect(sanitizeHref("https://x.com")).toBe("https://x.com");
    expect(sanitizeHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(sanitizeHref("/relative/path")).toBe("/relative/path");
    expect(sanitizeHref("#anchor")).toBe("#anchor");
    expect(sanitizeHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeHref("data:text/html;base64,xxx")).toBeNull();
  });
});
