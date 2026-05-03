// Single Firebase entry-point for the frontend. Per CLAUDE.md, never
// call initializeApp anywhere else. Real-time data hooks read `auth`
// and `firestore` from this module; tests mock the module wholesale.
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
  type Firestore,
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore";
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
    };
  }

  const requiredVars = [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
  ] as const;
  const missing = requiredVars.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase env vars: ${missing.join(", ")}. ` +
        "Copy frontend/.env.example to .env.local and fill in values.",
    );
  }

  const config: FirebaseClientConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };

  return config;
}

export const app: FirebaseApp = getApps()[0] ?? initializeApp(readConfig());

export const auth: Auth = getAuth(app);
export const firestore: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);

if (useEmulator && isBrowser) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
