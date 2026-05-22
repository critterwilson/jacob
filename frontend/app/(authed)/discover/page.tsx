"use client";

import { useCallback, useEffect, useState } from "react";

import { DiscoverFilters } from "@/components/discover/DiscoverFilters";
import { GroupCard } from "@/components/discover/GroupCard";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useDiscoverGroups } from "@/lib/hooks/useDiscoverGroups";

export default function DiscoverPage() {
  const { user, loading: authLoading } = useAuth();
  const [audience, setAudience] = useState("");
  const [q, setQ] = useState("");

  const { state, load, loadMore } = useDiscoverGroups({ audience, q });

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (authLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-cream-muted">Sign in to discover groups.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Discover groups</h1>

      <DiscoverFilters
        audience={audience}
        q={q}
        onAudienceChange={setAudience}
        onQChange={setQ}
      />

      {state.status === "loading" && (
        <p className="text-sm text-cream-muted">Loading…</p>
      )}

      {state.status === "error" && (
        <p role="alert" className="text-sm text-terracotta">{state.message}</p>
      )}

      {state.status === "ok" && (
        <>
          {state.groups.length === 0 ? (
            <p className="py-12 text-center text-cream-muted">No groups found.</p>
          ) : (
            <div className="space-y-4">
              {state.groups.map((g) => (
                <GroupCard key={g.gid} group={g} />
              ))}
            </div>
          )}
          {state.nextCursor && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
