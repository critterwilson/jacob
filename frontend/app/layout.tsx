import type { Metadata, Viewport } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { AppRegistrations } from "@/components/AppRegistrations";
import { IncidentBanner } from "@/components/IncidentBanner";
import { SentryInit } from "@/components/SentryInit";
import { AuthProvider } from "@/lib/auth-context";
import { BRAND_NAME, BRAND_DESCRIPTION } from "@/lib/brand";
import { WorkspaceOrgProvider, type WorkspaceOrg } from "@/lib/org-context";
import { ThemeProvider, themeInitScript } from "@/lib/theme-context";

// Variable fonts, latin subset only. Self-hosted by next/font.
// Combined cold-load impact ~50 KB. Exposed as CSS variables so
// styles/tokens.css can reference them via --font-display / --font-sans.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-eb-garamond",
  display: "swap",
});

export const metadata: Metadata = {
  // `template` brands every child page's <title> (e.g. "Sign in — Branch")
  // from the single BRAND_NAME constant, so pages set just their own label.
  title: { default: BRAND_NAME, template: `%s — ${BRAND_NAME}` },
  description: BRAND_DESCRIPTION,
  // The PWA manifest link is auto-injected from app/manifest.ts.
};

// viewport-fit=cover is what makes env(safe-area-inset-*) non-zero on
// iOS (notch + home indicator). Without it the page sits inside the
// safe rectangle and fixed UI collides with system chrome.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Match the page ground per OS preference. The ThemeProvider further
  // updates this meta when the user makes an explicit light/dark choice.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#d9c3ac" },
    { media: "(prefers-color-scheme: dark)", color: "#241310" },
  ],
};

function hydratedOrg(): WorkspaceOrg | null {
  const h = headers();
  const orgId = h.get("x-jacob-org-id");
  if (!orgId) return null;
  const audienceHeader = h.get("x-jacob-org-audience") ?? "christian";
  const audience: WorkspaceOrg["audience"] =
    audienceHeader === "general" ? "general" : "christian";
  return {
    orgId,
    name: h.get("x-jacob-org-name") ?? "",
    audience,
    logoUrl: h.get("x-jacob-org-logo"),
    primaryColor: h.get("x-jacob-org-color"),
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const org = hydratedOrg();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${ebGaramond.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* No-flash theme bootstrap: apply the persisted light/dark choice
            before first paint. Must run before the body renders. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="icon" href="/brand/favicon-32.png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/brand/branch-icon-light-192.png" />
        <link
          rel="apple-touch-icon"
          media="(prefers-color-scheme: dark)"
          href="/brand/branch-icon-dark-192.png"
        />
      </head>
      <body>
        {/*
          T62 — skip-to-content link: visible only on focus, jumps
          past the banner / nav so a keyboard / screen-reader user
          lands on the main content directly. Pages that mount a
          `<main id="main">` element automatically benefit.
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-1 focus:text-sm focus:text-ink"
        >
          Skip to content
        </a>
        <SentryInit />
        <ThemeProvider>
          <AuthProvider>
            <AppRegistrations />
            <WorkspaceOrgProvider org={org}>
              <IncidentBanner />
              {children}
            </WorkspaceOrgProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
