import { type NextRequest, NextResponse } from "next/server";

// Middleware provides a best-effort UX redirect for protected routes.
// The real access control is Firestore security rules — this only prevents
// accidental navigation before onboarding completes.
//
// "jacob-has-profile" is set by useUser.ts (client-side) once a users/{uid}
// document is confirmed in Firestore. It is NOT a security boundary.

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
