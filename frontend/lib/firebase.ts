// Single Firebase entry-point for the frontend. Per CLAUDE.md, never
// call initializeApp anywhere else. After M6 of the data-layer
// migration, only `auth` and `storage` are exported for *Firestore* —
// every Firestore read/write goes through the FastAPI backend's
// `/api/*` surface. T48 reintroduces Firebase Realtime Database (RTDB)
// for the ephemeral presence + typing signals; the membership mirror
// at `/memberships/{uid}/{gid}` enforces per-group authorization in
// the RTDB rules so the client→RTDB path stays safe to expose.
//
// The module is imported on both the server (during SSR / prerender of
// any page that pulls in a client component) and the client. Firebase
// API calls only happen on the client, so the env-var validation also
// only fires on the client — that lets `next build` succeed without a
// `.env.local`, while still giving a clear runtime error in the browser
// if config is missing.

import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  connectAuthEmulator,
  getAuth,
} from "firebase/auth";
import {
  type Database,
  connectDatabaseEmulator,
  getDatabase,
} from "firebase/database";
import {
  type FirebaseStorage,
  connectStorageEmulator,
  getStorage,
} from "firebase/storage";

type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  databaseURL?: string;
};

const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
const isBrowser = typeof window !== "undefined";

function readConfig(): FirebaseClientConfig {
  if (useEmulator) {
    return {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
      authDomain:
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
        "demo-jacob.firebaseapp.com",
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-jacob",
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "demo-app-id",
      databaseURL:
        process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
        "http://127.0.0.1:9000/?ns=demo-jacob",
    };
  }

  // Each access must be a static `process.env.X` literal — Next.js only
  // inlines those into the client bundle. `process.env[varName]` with a
  // dynamic key stays as a runtime lookup against `{}` and reports every
  // var as missing even when they were inlined elsewhere in the file.
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  const missing: string[] = [];
  if (!apiKey) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!authDomain) missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!projectId) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!appId) missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase env vars: ${missing.join(", ")}. ` +
        "Copy frontend/.env.example to .env.local and fill in values.",
    );
  }

  return {
    apiKey: apiKey!,
    authDomain: authDomain!,
    projectId: projectId!,
    appId: appId!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  };
}

export const app: FirebaseApp = getApps()[0] ?? initializeApp(readConfig());

export const auth: Auth = getAuth(app);
export const storage: FirebaseStorage = getStorage(app);

// T48 — Realtime Database for presence + typing. `getDatabase` is
// safe to call without a databaseURL on the config; it falls back to
// the project's default RTDB instance.
export const rtdb: Database = getDatabase(app);

if (useEmulator && isBrowser) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  connectDatabaseEmulator(rtdb, "127.0.0.1", 9000);
}
