"use client";

// T55 — workspace org context.
//
// Hydrated by `frontend/app/layout.tsx` from headers attached by
// `frontend/middleware.ts` (`x-jacob-org-id`, `x-jacob-org-name`,
// `x-jacob-org-audience`). When the user visits the bare host
// (`jacob.app`), no org is attached and `org === null`.
//
// Components that branding/logo/audience care about consume `useOrg()`
// from this context. The `org-by-host` API call lives in the
// middleware, NOT in the client — exposing it client-side would defeat
// the SSR redirect flow and double the network hit.

import {
  type ReactNode,
  createContext,
  useContext,
} from "react";

export type WorkspaceOrg = {
  orgId: string;
  name: string;
  audience: "christian" | "bjj" | "general";
  logoUrl: string | null;
  primaryColor: string | null;
};

const WorkspaceOrgContext = createContext<WorkspaceOrg | null>(null);

export function WorkspaceOrgProvider({
  org,
  children,
}: {
  org: WorkspaceOrg | null;
  children: ReactNode;
}) {
  return (
    <WorkspaceOrgContext.Provider value={org}>
      {children}
    </WorkspaceOrgContext.Provider>
  );
}

export function useWorkspaceOrg(): WorkspaceOrg | null {
  return useContext(WorkspaceOrgContext);
}
