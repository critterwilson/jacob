"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { firestore } from "@/lib/firebase";

export type UserProfile = {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  role: string;
  schemaVersion: number;
  isMinor: boolean;
  createdAt: unknown;
  phone?: string;
  location?: string;
  faithBackground?: string;
};

export type UseUserResult =
  | { loading: true; profile: null }
  | { loading: false; profile: UserProfile }
  | { loading: false; profile: null };

export function useUser(uid: string | undefined): UseUserResult {
  const [state, setState] = useState<UseUserResult>({ loading: true, profile: null });

  useEffect(() => {
    if (!uid) {
      setState({ loading: false, profile: null });
      return;
    }

    setState({ loading: true, profile: null });

    const unsub = onSnapshot(
      doc(firestore, "users", uid),
      (snap) => {
        if (snap.exists()) {
          setState({
            loading: false,
            profile: { uid, ...(snap.data() as Omit<UserProfile, "uid">) },
          });
          // Best-effort cookie so middleware can short-circuit on protected routes.
          if (typeof document !== "undefined") {
            document.cookie = "jacob-has-profile=1; path=/; SameSite=Lax";
          }
        } else {
          setState({ loading: false, profile: null });
          if (typeof document !== "undefined") {
            document.cookie =
              "jacob-has-profile=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
          }
        }
      },
      () => {
        setState({ loading: false, profile: null });
      },
    );

    return unsub;
  }, [uid]);

  return state;
}
