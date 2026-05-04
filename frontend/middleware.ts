import { type NextRequest, NextResponse } from "next/server";

// Middleware provides a best-effort UX redirect for protected routes.
// Real access control lives in FastAPI dependencies (`require_member`,
// `require_leader`, etc.) — not in Firestore security rules, which are
// default-deny since M6. This middleware only prevents accidental
// navigation to a group/chat URL before onboarding completes.
//
// "jacob-has-profile" is set server-side by `GET /api/users/me/bootstrap`
// (and on profile create). It is NOT a security boundary, just a UX
// optimisation. See data-layer migration plan §7.M2.5.

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasProfile = request.cookies.get("jacob-has-profile")?.value === "1";

  if (!hasProfile) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/groups/:path*", "/chat/:path*"],
};
