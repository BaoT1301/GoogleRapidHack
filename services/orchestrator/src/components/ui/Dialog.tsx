"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { XIcon } from "@phosphor-icons/react";
import { Bezel } from "@/components/ui/Bezel";

/** Centered modal with a blurred backdrop. Closes on Escape or backdrop click. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  widthClassName = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /**
   * Tailwind max-width class controlling the dialog width. Defaults to
   * `max-w-md` (the original size) so existing call sites are unaffected; wide
   * surfaces like the tabbed Settings panel pass e.g. `max-w-3xl`.
   */
  widthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 grid place-items-center bg-scrim p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            className={`w-full ${widthClassName}`}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <Bezel innerClassName="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight text-content">
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  aria-label="Close dialog"
                  className="text-faint transition-colors hover:text-content"
                >
                  <XIcon size={16} />
                </button>
              </div>
              <div className="max-h-[calc(100dvh-9rem)] overflow-y-auto">
                {children}
              </div>
            </Bezel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
