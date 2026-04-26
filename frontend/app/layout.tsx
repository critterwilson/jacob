import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
