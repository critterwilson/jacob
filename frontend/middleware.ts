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
// 2. **Onboarding gate.** A best-effort UX redirect that runs on every
//    request inside the matcher and bounces users without a JACOB
//    profile to `/onboarding`. The single source of truth is the
//    `PUBLIC_PATHS` allow-list below; everything else is gated.
//    `jacob-has-profile` is set by `GET /api/users/me/bootstrap` (M2).
//    Real access control still lives in FastAPI deps — this is purely
//    a UX rail so profileless users don't see half-broken pages.
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
  if (requiresProfile(pathname)) {
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

// Single source of truth for "this path can be visited without a JACOB
// profile". Anything not in this set requires the `jacob-has-profile`
// cookie set by `GET /api/users/me/bootstrap`. Static assets and
// `/api/*` are excluded by the matcher below, not here.
//
// `/onboarding` and `/verify-email` are intentionally open: they are
// the routes where a profileless / unverified user is supposed to land,
// so gating them would create a redirect loop.
const PUBLIC_PATHS = new Set<string>([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/verify-email",
  "/onboarding",
  "/about",
  "/privacy",
  "/terms",
  "/guidelines",
  "/faq",
  "/transparency",
  "/design",
]);

function requiresProfile(pathname: string): boolean {
  // Exact-match the path against the public set. Any nested path under
  // a top-level segment that isn't in the set still requires a profile
  // — e.g. `/admin/users` is gated even though `/about` is public.
  if (PUBLIC_PATHS.has(pathname)) return false;
  // `/design` is a developer surface with sub-pages; treat the whole
  // tree as public so we don't gate the design system on staging.
  if (pathname === "/design" || pathname.startsWith("/design/")) return false;
  return true;
}

// Run on every page request EXCEPT static assets, the service worker,
// and Next.js internals. The matcher excludes API routes (those go
// straight to the backend) and asset paths.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|sw.js|manifest.webmanifest|api).*)",
  ],
};
