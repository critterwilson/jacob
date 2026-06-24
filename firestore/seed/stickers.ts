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
  audience: "christian" | "general";
  order: number;
  color: string;
};

// Sticker palette retuned for the dark-first design system (PR 9 of the
// design sweep). Earlier values were vivid Tailwind primaries sized for
// a light surface; on the new ink ground (#0E1726) those read as acidic.
// New values are jewel-toned: ~30-50% saturation, mid-luminance, each
// readable as text on its own 15%-alpha background. Sticker identities
// preserved (blue-ish stays blue-ish, etc.). See docs/design-tokens.md.
const STICKERS: StickerDoc[] = [
  // Christian audience (Phase 1).
  { slug: "check-in",       name: "Check-In",       audience: "christian", order: 1, color: "#7AA2D9" },
  { slug: "prayer-request", name: "Prayer Request",  audience: "christian", order: 2, color: "#A98EE0" },
  { slug: "praise-report",  name: "Praise Report",   audience: "christian", order: 3, color: "#D9B068" },
  { slug: "offering-help",  name: "Offering Help",   audience: "christian", order: 4, color: "#7E9B7C" },
  { slug: "need-help",      name: "Need Help",       audience: "christian", order: 5, color: "#C16B5C" },
  { slug: "event-meetup",   name: "Event / Meetup",  audience: "christian", order: 6, color: "#D58FA8" },

  // Cross-audience "general" stickers — usable in any group regardless
  // of the parent group's audience. Keeps groups from feeling silo'd
  // when a member just wants a thumbs-up.
  { slug: "encouragement", name: "Encouragement", audience: "general", order: 21, color: "#7FB39A" },
  { slug: "question",      name: "Question",      audience: "general", order: 22, color: "#82A2C2" },
  { slug: "praise",        name: "Praise",        audience: "general", order: 23, color: "#D9BE7C" },
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
