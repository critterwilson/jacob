import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { SentryInit } from "@/components/SentryInit";

export const metadata: Metadata = {
  title: "JACOB",
  description: "Small-group messaging for Christian communities",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SentryInit />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
