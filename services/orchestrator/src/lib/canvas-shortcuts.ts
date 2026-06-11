/** Canvas keyboard shortcuts — pure resolution so it's unit-testable without a DOM. */

export type ShortcutAction = "delete" | "select-all" | "escape" | "run" | null;

/** True when focus is in a text field, so shortcuts must NOT fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** Map a keydown to a canvas action. Returns null while typing or for unmapped keys. */
export function resolveShortcut(
  e: ShortcutEvent,
  editable: boolean,
): ShortcutAction {
  if (editable) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === "Delete" || e.key === "Backspace") return "delete";
  if (mod && (e.key === "a" || e.key === "A")) return "select-all";
  if (mod && e.key === "Enter") return "run";
  if (e.key === "Escape") return "escape";
  return null;
}
