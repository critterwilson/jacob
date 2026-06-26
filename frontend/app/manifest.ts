import type { MetadataRoute } from "next";

import { BRAND_NAME, BRAND_DESCRIPTION } from "@/lib/brand";

// Dynamic PWA manifest (served at /manifest.webmanifest). Generated from
// the single BRAND_NAME constant so a rename needs no manifest edit. Colors
// track the Branch deep-espresso ground (the install splash + standalone
// chrome read as the dark brand identity); start_url points at /groups.
// Icons are the owner's real tree mark on sand (light) and espresso (dark).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    start_url: "/groups",
    display: "standalone",
    background_color: "#241310",
    theme_color: "#241310",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/brand/branch-icon-light-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/branch-icon-light-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/branch-icon-dark-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/branch-icon-dark-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
