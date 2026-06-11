"use client";

// Reusable xterm.js surface. Two modes:
//   • read-only (default) — a faithful renderer for streamed CLI output. Replaces
//     the old plain-<div> log view so ANSI colour / 256 / 24-bit / cursor / erase
//     sequences (e.g. kiro's spinners) render correctly instead of as raw escapes.
//   • interactive (`readOnly={false}`) — captures keystrokes and forwards them via
//     `onData` (used by the worktree shell over a WebSocket).
//
// xterm touches the DOM/canvas, so the module is dynamically imported inside an
// effect (never during SSR) and every DOM call is guarded so jsdom-based unit
// tests stay green. Callers drive output through the imperative `write` handle;
// writes that arrive before the terminal is mounted are queued and flushed.
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import "@xterm/xterm/css/xterm.css";

// Minimal structural types so we don't depend on xterm's types at module load
// (keeps the dynamic-import boundary clean and tests easy to mock).
interface TerminalLike {
  write(data: string | Uint8Array): void;
  clear(): void;
  focus(): void;
  dispose(): void;
  open(el: HTMLElement): void;
  loadAddon(addon: unknown): void;
  options: { theme?: unknown };
  onData(cb: (data: string) => void): { dispose(): void };
  onResize(cb: (size: { cols: number; rows: number }) => void): { dispose(): void };
}
interface FitAddonLike {
  fit(): void;
}

export interface XtermHandle {
  /** Write raw bytes/string (incl. ANSI escapes) to the terminal. */
  write: (data: string | Uint8Array) => void;
  /** Clear the screen + scrollback. */
  clear: () => void;
  /** Re-fit to the container size. */
  fit: () => void;
  /** Focus the terminal (interactive mode). */
  focus: () => void;
}

export interface XtermViewProps {
  className?: string;
  /** When true (default) stdin is disabled — pure output renderer. */
  readOnly?: boolean;
  /** Interactive mode: user keystrokes. */
  onData?: (data: string) => void;
  /** Fired on terminal resize (cols/rows) — drives PTY resize. */
  onResize?: (size: { cols: number; rows: number }) => void;
  /** Fired once the terminal is mounted and ready. */
  onReady?: () => void;
}

// Terminal palettes aligned with the app surface tokens. xterm needs concrete
// colors (it paints to a canvas, so it can't read CSS vars), so we mirror the
// two themes here and swap them live when <html data-theme> changes.
const DARK_THEME = {
  background: "#0b0e14",
  foreground: "#c6c9d1",
  cursor: "#c6c9d1",
  selectionBackground: "#2a3140",
};

const LIGHT_THEME = {
  background: "#fbfbf9",
  foreground: "#23262d",
  cursor: "#23262d",
  selectionBackground: "#cdd1de",
  // Default xterm ANSI colors are tuned for dark backgrounds and wash out on
  // white, so provide a light-friendly 16-color set.
  black: "#0f0f14",
  red: "#8c4351",
  green: "#485e30",
  yellow: "#8f5e15",
  blue: "#34548a",
  magenta: "#5a3e8e",
  cyan: "#0f4b6e",
  white: "#343b58",
  brightBlack: "#9699a3",
  brightRed: "#a9505f",
  brightGreen: "#5a703c",
  brightYellow: "#a06c1a",
  brightBlue: "#3e63a0",
  brightMagenta: "#6b4ca0",
  brightCyan: "#166b8f",
  brightWhite: "#1a1c22",
};

/** Read the active theme from <html data-theme> (set by the no-flash script). */
function readTerminalTheme() {
  if (typeof document === "undefined") return DARK_THEME;
  return document.documentElement.getAttribute("data-theme") === "light"
    ? LIGHT_THEME
    : DARK_THEME;
}

export const XtermView = forwardRef<XtermHandle, XtermViewProps>(function XtermView(
  { className, readOnly = true, onData, onResize, onReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<TerminalLike | null>(null);
  const fitRef = useRef<FitAddonLike | null>(null);
  // Writes that arrive before the async terminal mount are buffered here.
  const queueRef = useRef<(string | Uint8Array)[]>([]);
  // Keep the latest callbacks without re-running the mount effect.
  const cbRef = useRef({ onData, onResize, onReady });
  cbRef.current = { onData, onResize, onReady };

  useImperativeHandle(
    ref,
    () => ({
      write: (data) => {
        if (termRef.current) termRef.current.write(data);
        else queueRef.current.push(data);
      },
      clear: () => termRef.current?.clear(),
      fit: () => {
        try {
          fitRef.current?.fit();
        } catch {
          /* container not measurable (jsdom) */
        }
      },
      focus: () => termRef.current?.focus(),
    }),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let term: TerminalLike | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let themeObserver: MutationObserver | undefined;
    let dataDisposable: { dispose(): void } | undefined;
    let resizeDisposable: { dispose(): void } | undefined;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;

      term = new Terminal({
        convertEol: false,
        cursorBlink: !readOnly,
        disableStdin: readOnly,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
        fontSize: 12,
        theme: readTerminalTheme(),
        scrollback: 5000,
      }) as unknown as TerminalLike;

      const fit = new FitAddon() as unknown as FitAddonLike;
      term.loadAddon(fit);
      term.open(containerRef.current);
      try {
        fit.fit();
      } catch {
        /* jsdom: no layout */
      }

      termRef.current = term;
      fitRef.current = fit;

      // Flush anything queued before mount.
      for (const d of queueRef.current) term.write(d);
      queueRef.current = [];

      if (!readOnly && cbRef.current.onData) {
        dataDisposable = term.onData((d) => cbRef.current.onData?.(d));
      }
      resizeDisposable = term.onResize((s) => cbRef.current.onResize?.(s));

      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          try {
            fit.fit();
          } catch {
            /* not measurable */
          }
        });
        resizeObserver.observe(containerRef.current);
      }

      // Repaint the palette live when the app theme toggles. xterm can't read
      // CSS vars, so we watch <html data-theme> and reassign the theme option.
      if (typeof MutationObserver !== "undefined") {
        themeObserver = new MutationObserver(() => {
          if (term) term.options.theme = readTerminalTheme();
        });
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });
      }

      cbRef.current.onReady?.();
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      dataDisposable?.dispose?.();
      resizeDisposable?.dispose?.();
      try {
        term?.dispose?.();
      } catch {
        /* already disposed */
      }
      termRef.current = null;
      fitRef.current = null;
    };
  }, [readOnly]);

  return <div ref={containerRef} className={className} />;
});
