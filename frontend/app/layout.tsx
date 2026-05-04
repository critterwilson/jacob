import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { SentryInit } from "@/components/SentryInit";
import { AuthProvider } from "@/lib/auth-context";
import { WorkspaceOrgProvider, type WorkspaceOrg } from "@/lib/org-context";

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
    <html lang="en">
      <head>
        <meta name="theme-color" content="#1e40af" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body>
        <SentryInit />
        <AuthProvider>
          <WorkspaceOrgProvider org={org}>{children}</WorkspaceOrgProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
