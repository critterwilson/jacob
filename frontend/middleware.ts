import { type NextRequest, NextResponse } from "next/server";

// Middleware does two things:
//
// 1. **Workspace org resolution (T55).** If the host is a `*.jacob.app`
//    subdomain or a vanity domain that an org has claimed via
//    `/api/orgs/{orgId}/subdomain` or `/api/orgs/{orgId}/custom-domain`,
//    look the org up via the unauthenticated `/api/by-host` endpoint
//    and attach `x-jacob-org-id`, `x-jacob-org-name`,
//    `x-jacob-org-audience`, `x-jacob-org-logo`, `x-jacob-org-color`
//    headers to the downstream request. The Next.js `headers()` helper
//    in `app/layout.tsx` reads them and hydrates the client-side
//    workspace-org context.
//
// 2. **Onboarding gate (existing).** A best-effort UX redirect for
//    protected routes — real access control lives in FastAPI deps.
//    `jacob-has-profile` is set by `GET /api/users/me/bootstrap` (M2).
//
// The host lookup is short-cached in the edge worker's module scope
// to keep the latency overhead under ~5ms once warm. TTL is 5 minutes;
// a longer TTL would mask org changes (logo / brand color) for too
// long after the operator updates them.

const HOST_LOOKUP_TTL_MS = 5 * 60 * 1000;
const BASE_DOMAIN = process.env.JACOB_BASE_DOMAIN ?? "jacob.app";
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type CachedOrg = {
  orgId: string;
  name: string;
  audience: string;
  logoUrl: string | null;
  primaryColor: string | null;
};

const _hostCache = new Map<string, { org: CachedOrg | null; at: number }>();

function isReservedHost(host: string): boolean {
  // Bare apex + www; never look these up.
  return host === BASE_DOMAIN || host === `www.${BASE_DOMAIN}`;
}

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host.startsWith("127.") ||
    host === "::1"
  );
}

async function resolveOrg(host: string): Promise<CachedOrg | null> {
  const cleaned = host.toLowerCase().split(":")[0];
  if (!cleaned || isLocalHost(cleaned) || isReservedHost(cleaned)) return null;

  const cached = _hostCache.get(cleaned);
  if (cached && Date.now() - cached.at < HOST_LOOKUP_TTL_MS) {
    return cached.org;
  }

  if (!API_BASE) {
    // No API configured (local dev without an explicit URL). Skip.
    _hostCache.set(cleaned, { org: null, at: Date.now() });
    return null;
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/by-host?host=${encodeURIComponent(cleaned)}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) {
      _hostCache.set(cleaned, { org: null, at: Date.now() });
      return null;
    }
    const data = (await res.json()) as CachedOrg;
    _hostCache.set(cleaned, { org: data, at: Date.now() });
    return data;
  } catch {
    _hostCache.set(cleaned, { org: null, at: Date.now() });
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const org = await resolveOrg(host);

  const requestHeaders = new Headers(request.headers);
  if (org) {
    requestHeaders.set("x-jacob-org-id", org.orgId);
    requestHeaders.set("x-jacob-org-name", org.name);
    requestHeaders.set("x-jacob-org-audience", org.audience);
    if (org.logoUrl) requestHeaders.set("x-jacob-org-logo", org.logoUrl);
    if (org.primaryColor) {
      requestHeaders.set("x-jacob-org-color", org.primaryColor);
    }
  }

  const { pathname } = request.nextUrl;
  if (!isPublicPath(pathname)) {
    // UX hint only — not an auth gate. The cookie is mirrored from the
    // bootstrap response and can be spoofed; real access control lives
    // in FastAPI deps (`get_current_user` + `require_member` etc.).
    const hasProfile =
      request.cookies.get("jacob-has-profile")?.value === "1";
    if (!hasProfile) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

// Routes that must remain reachable without a profile cookie:
//   - the landing page and marketing/legal pages,
//   - the auth flow (sign-in / sign-up / forgot-password / verify-email),
//   - /onboarding itself (target of the redirect — gating it would loop),
//   - /join (invite-acceptance landing — handled separately by its own
//     auth check),
//   - /transparency (public report).
// Everything else (groups, chat, boards, discover, devotionals, sermons,
// search, orgs, admin, appeals, reading-plans, home, settings, …) is
// gated. /api/* and static asset paths are excluded by `config.matcher`.
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/verify-email",
  "/onboarding",
  // Legacy ADR 0012 path. Under ADR 0014 it just redirects to /home,
  // but the route stays reachable so old bookmarks don't 404. Keep it
  // in the public list because users without a profile cookie may
  // land here from external links.
  "/awaiting-approval",
  "/privacy",
  "/terms",
  "/guidelines",
  "/faq",
  "/about",
  "/join",
  "/transparency",
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

// Run on every page request EXCEPT static assets, the service worker,
// and Next.js internals. The matcher excludes API routes (those go
// straight to the backend) and asset paths.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|sw.js|manifest.webmanifest|api).*)",
  ],
};
