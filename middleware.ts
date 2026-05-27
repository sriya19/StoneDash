import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { checkIpRateLimit } from "@/lib/share-link/rate-limit";

// Paths that require an authenticated user. Anything under one of these
// prefixes redirects to /login when no session is present.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/orders",
  "/customers",
  "/settings",
  "/inventory",
  "/schedule",
  "/invoices",
  "/team",
  "/onboarding",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public /j/[slug] share pages — rate limit at the edge before any DB
  // lookup. 30/min per IP. See lib/share-link/rate-limit.ts for the
  // in-memory caveats.
  if (pathname.startsWith("/j/")) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const limit = checkIpRateLimit(ip);
    if (!limit.ok) {
      return new NextResponse("Too many requests", {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      });
    }
    // Don't run the auth flow for public pages — pass through to the page.
    return NextResponse.next();
  }

  const { response, user } = await updateSession(request);

  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (needsAuth && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If a signed-in user hits /login or /signup, bounce them into the app.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = "/dashboard";
    dashUrl.search = "";
    return NextResponse.redirect(dashUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Exclude Next internals, static assets, and image optimizer paths.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
