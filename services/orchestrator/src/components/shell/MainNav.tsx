"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn } from "@clerk/clerk-react";
import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
};

/**
 * Feature destinations surfaced in the top bar. Dashboard doubles as the graph
 * list (its route renders DashboardView); Debug Run spawns a real agent in an
 * isolated worktree. Add new feature areas here to extend the nav.
 */
const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/debug-run", label: "Debug Run" },
];

/**
 * Primary in-chrome navigation: text links to the app's feature areas with the
 * active route highlighted. Links are gated behind Clerk's <SignedIn> so
 * signed-out visitors (e.g. on the landing page) see only the logo + Sign In.
 *
 * Active state uses exact-path matching so visiting /dashboard/debug-run does
 * not also light up the /dashboard link.
 */
export function MainNav() {
  const pathname = usePathname();

  return (
    <SignedIn>
      <nav aria-label="Primary" className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-accent-soft text-accent"
                  : "text-faint hover:bg-hover hover:text-content",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </SignedIn>
  );
}
