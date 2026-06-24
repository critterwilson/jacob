import type { MetadataRoute } from "next";

import { BRAND_NAME, BRAND_DESCRIPTION } from "@/lib/brand";

// Dynamic PWA manifest (served at /manifest.webmanifest). Generated from
// the single BRAND_NAME constant so a rename needs no manifest edit.
// Colors track the Olive Branch "Evening Olive" dark ground; start_url
// points at /groups (the old /home destination was removed in the v2
// redesign).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    start_url: "/groups",
    display: "standalone",
    background_color: "#1c2118",
    theme_color: "#1c2118",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192-maskable.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
