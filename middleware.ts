import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

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
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

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
