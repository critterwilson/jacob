import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { AppRegistrations } from "@/components/AppRegistrations";
import { IncidentBanner } from "@/components/IncidentBanner";
import { SentryInit } from "@/components/SentryInit";
import { AuthProvider } from "@/lib/auth-context";
import { WorkspaceOrgProvider, type WorkspaceOrg } from "@/lib/org-context";

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
  title: "JACOB",
  description: "Small-group messaging for Christian communities",
  manifest: "/manifest.webmanifest",
};

function hydratedOrg(): WorkspaceOrg | null {
  const h = headers();
  const orgId = h.get("x-jacob-org-id");
  if (!orgId) return null;
  const audienceHeader = h.get("x-jacob-org-audience") ?? "christian";
  const audience: WorkspaceOrg["audience"] =
    audienceHeader === "bjj" || audienceHeader === "general"
      ? audienceHeader
      : "christian";
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
    <html lang="en" className={`${inter.variable} ${ebGaramond.variable}`}>
      <head>
        <meta name="theme-color" content="#0e1726" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
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
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-blue-700 focus:px-3 focus:py-1 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        <SentryInit />
        <AuthProvider>
          <AppRegistrations />
          <WorkspaceOrgProvider org={org}>
            <IncidentBanner />
            {children}
          </WorkspaceOrgProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
