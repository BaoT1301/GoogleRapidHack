"use client";

import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import { GraphIcon } from "@phosphor-icons/react/dist/ssr";
import { MainNav } from "@/components/shell/MainNav";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

/**
 * App shell: sticky hairline top bar over a flex content slot. The left side
 * holds the logo + primary nav (MainNav); the right side holds chrome controls
 * (theme toggle, Settings, account). Feature nav + Settings are gated behind
 * <SignedIn> so signed-out visitors see only the logo. Client component (uses the
 * client-only Clerk React SDK); server-rendered page content arrives via `children`.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/75 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-5">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="group flex items-center gap-2.5"
            >
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105">
                <GraphIcon size={16} weight="duotone" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-content">
                Orchestrator
              </span>
            </Link>
            <MainNav />
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <SignedIn>
              <SettingsPanel triggerVariant="nav" />
              <UserButton
                appearance={{ elements: { avatarBox: "h-7 w-7" } }}
              />
            </SignedIn>
            <SignedOut>
              <SignInButton mode="redirect">
                <button
                  type="button"
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90"
                >
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
