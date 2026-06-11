"use client";

import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui/Tooltip";
import { useTheme } from "@/components/theme/ThemeProvider";

/**
 * Header control that flips between light and dark. Renders a fixed-size,
 * hairline icon button consistent with the SettingsPanel trigger beside it.
 *
 * The active theme isn't known during SSR (the no-flash script sets it on the
 * client), so the icon is only rendered after mount to avoid a hydration
 * mismatch; the button keeps its footprint reserved in the meantime.
 */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolved === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <Tooltip label={mounted ? label : "Toggle theme"}>
      <button
        type="button"
        onClick={toggle}
        aria-label={mounted ? label : "Toggle theme"}
        className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {mounted ? (
          isDark ? (
            <SunIcon size={16} weight="duotone" />
          ) : (
            <MoonIcon size={16} weight="duotone" />
          )
        ) : (
          <span className="h-4 w-4" aria-hidden />
        )}
      </button>
    </Tooltip>
  );
}
