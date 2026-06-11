"use client";

import { ClerkProvider } from "@clerk/clerk-react";
import { MotionConfig } from "motion/react";
import { TRPCReactProvider } from "@/trpc/client";
import { ToastProvider } from "@/components/ui/Toast";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

/**
 * Root client providers. ClerkProvider uses the CLIENT-ONLY Clerk React SDK with
 * only the PUBLISHABLE key — no CLERK_SECRET_KEY on the laptop. Sign-in happens
 * client-side; the session token rides the __session cookie to the local server,
 * which forwards it to the cloud BFF (auth.whoami) that holds the secret + verifies.
 * `reducedMotion="user"` makes Motion animations honor `prefers-reduced-motion`.
 */
const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";
const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl={signInUrl}
      signUpUrl={signUpUrl}
      afterSignOutUrl="/"
    >
      <ThemeProvider>
        <TRPCReactProvider>
          <MotionConfig reducedMotion="user">
            <ToastProvider>{children}</ToastProvider>
          </MotionConfig>
        </TRPCReactProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}
