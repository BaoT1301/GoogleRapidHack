import { render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XtermView, type XtermHandle } from "@/components/run/XtermView";

// xterm touches canvas/DOM that jsdom lacks, so we mock the two dynamic imports
// and assert XtermView drives them correctly (open/write/onData/dispose).
const writes: (string | Uint8Array)[] = [];
let dataCb: ((d: string) => void) | undefined;
const opened: HTMLElement[] = [];
let disposed = false;

class FakeTerminal {
  constructor(public opts: Record<string, unknown>) {}
  loadAddon() {}
  open(el: HTMLElement) {
    opened.push(el);
  }
  write(d: string | Uint8Array) {
    writes.push(d);
  }
  clear() {}
  focus() {}
  dispose() {
    disposed = true;
  }
  onData(cb: (d: string) => void) {
    dataCb = cb;
    return { dispose() {} };
  }
  onResize() {
    return { dispose() {} };
  }
}
class FakeFitAddon {
  fit() {}
}

vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: FakeFitAddon }));

beforeEach(() => {
  writes.length = 0;
  opened.length = 0;
  dataCb = undefined;
  disposed = false;
});
afterEach(() => vi.clearAllMocks());

describe("XtermView", () => {
  it("mounts a terminal and renders ANSI writes (incl. queued-before-ready)", async () => {
    const ref = createRef<XtermHandle>();
    // Write BEFORE the async terminal mount — must be queued + flushed.
    const { rerender } = render(<XtermView ref={ref} />);
    ref.current?.write("\x1b[38;5;11mwarn\x1b[0m\r\n");

    await waitFor(() => expect(opened.length).toBe(1));
    // Queued write flushed once ready.
    await waitFor(() => expect(writes).toContain("\x1b[38;5;11mwarn\x1b[0m\r\n"));

    // A post-ready write goes straight through.
    ref.current?.write("more");
    expect(writes).toContain("more");

    // Unmount disposes the terminal.
    rerender(<></>);
  });

  it("forwards keystrokes via onData when interactive", async () => {
    const onData = vi.fn();
    render(<XtermView readOnly={false} onData={onData} />);
    await waitFor(() => expect(dataCb).toBeTypeOf("function"));
    dataCb?.("ls\r");
    expect(onData).toHaveBeenCalledWith("ls\r");
  });

  it("does not wire stdin in read-only mode", async () => {
    render(<XtermView readOnly />);
    await waitFor(() => expect(opened.length).toBe(1));
    expect(dataCb).toBeUndefined();
  });
});
