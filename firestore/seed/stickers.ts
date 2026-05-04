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
  // Christian audience (Phase 1).
  { slug: "check-in",       name: "Check-In",       audience: "christian", order: 1, color: "#2563EB" },
  { slug: "prayer-request", name: "Prayer Request",  audience: "christian", order: 2, color: "#7C3AED" },
  { slug: "praise-report",  name: "Praise Report",   audience: "christian", order: 3, color: "#D97706" },
  { slug: "offering-help",  name: "Offering Help",   audience: "christian", order: 4, color: "#059669" },
  { slug: "need-help",      name: "Need Help",       audience: "christian", order: 5, color: "#DC2626" },
  { slug: "event-meetup",   name: "Event / Meetup",  audience: "christian", order: 6, color: "#DB2777" },

  // BJJ audience (T56). Picked to match the BJJ training cadence: roll
  // partners, prep, technique discussion, recovery, conditioning,
  // milestones (stripes / belts / first comp).
  { slug: "roll-partner-needed", name: "Roll Partner Needed", audience: "bjj", order: 11, color: "#1D4ED8" },
  { slug: "tournament-prep",     name: "Tournament Prep",     audience: "bjj", order: 12, color: "#B91C1C" },
  { slug: "technique-question",  name: "Technique Question",  audience: "bjj", order: 13, color: "#0E7490" },
  { slug: "recovery",            name: "Recovery",            audience: "bjj", order: 14, color: "#15803D" },
  { slug: "conditioning",        name: "Conditioning",        audience: "bjj", order: 15, color: "#9333EA" },
  { slug: "bjj-milestone",       name: "Milestone",           audience: "bjj", order: 16, color: "#C2410C" },

  // Cross-audience "general" stickers — usable in any group regardless
  // of the parent group's audience. Keeps the Christian and BJJ surfaces
  // from feeling silo'd when a member just wants a thumbs-up.
  { slug: "encouragement", name: "Encouragement", audience: "general", order: 21, color: "#10B981" },
  { slug: "question",      name: "Question",      audience: "general", order: 22, color: "#0284C7" },
  { slug: "praise",        name: "Praise",        audience: "general", order: 23, color: "#F59E0B" },
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
