import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Lightweight auth gate — holds NO Clerk secret. Auth is the CLIENT-ONLY Clerk
// React SDK (publishable key); real verification happens at the cloud BFF
// (auth.whoami, which holds CLERK_SECRET_KEY). This middleware only redirects
// unauthenticated users away from app pages based on the presence of Clerk's
// `__session` cookie (clerk-js sets it on sign-in). It does NOT verify the cookie
// (that's the BFF's job) — a forged cookie gets past this redirect but can read no
// data, since every data op is verified server-side at the BFF. API/tRPC routes are
// not gated here; they authenticate themselves via the forwarded token.
export function middleware(req: NextRequest) {
  const isAppPage = req.nextUrl.pathname.startsWith("/dashboard");
  const hasSession = req.cookies.has("__session");
  if (isAppPage && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
