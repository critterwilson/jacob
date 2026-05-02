#!/usr/bin/env tsx
// Run: pnpm seed:stickers           → writes to production Firestore (ADC)
//      pnpm seed:stickers --emulator → writes to local emulator

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const USE_EMULATOR = process.argv.includes("--emulator");

if (USE_EMULATOR) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
}

type StickerDoc = {
  slug: string;
  name: string;
  audience: "christian" | "bjj" | "general";
  order: number;
  color: string;
};

const STICKERS: StickerDoc[] = [
  { slug: "check-in",       name: "Check-In",       audience: "christian", order: 1, color: "#2563EB" },
  { slug: "prayer-request", name: "Prayer Request",  audience: "christian", order: 2, color: "#7C3AED" },
  { slug: "praise-report",  name: "Praise Report",   audience: "christian", order: 3, color: "#D97706" },
  { slug: "offering-help",  name: "Offering Help",   audience: "christian", order: 4, color: "#059669" },
  { slug: "need-help",      name: "Need Help",       audience: "christian", order: 5, color: "#DC2626" },
  { slug: "event-meetup",   name: "Event / Meetup",  audience: "christian", order: 6, color: "#DB2777" },
];

const app =
  getApps()[0] ??
  initializeApp(USE_EMULATOR ? { projectId: "demo-jacob" } : undefined);

const db = getFirestore(app);
const batch = db.batch();

for (const sticker of STICKERS) {
  batch.set(db.collection("stickers").doc(sticker.slug), sticker);
}

await batch.commit();
console.log(
  `Seeded ${STICKERS.length} stickers${USE_EMULATOR ? " (emulator)" : ""}.`,
);
