import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/AppShell";
import { NO_FLASH_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Auth is the CLIENT-ONLY Clerk React SDK (publishable key) — ClerkProvider now
// lives in Providers (client), so the local app holds NO CLERK_SECRET_KEY. The BFF
// verifies the forwarded session token. This layout stays a server component so it
// can still export `metadata`.
export const metadata: Metadata = {
  title: "AI Workflow Orchestrator",
  description: "ComfyUI for AI software engineering",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the persisted theme before first paint to avoid a flash of the
            wrong color scheme (themePacks). Must run before the body renders. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-surface font-sans text-content antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
