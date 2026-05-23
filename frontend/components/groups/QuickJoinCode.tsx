"use client";

import { useEffect, useState } from "react";

import { Banner, Button } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useGroup } from "@/lib/hooks/useGroup";

type Props = { gid: string };

export function QuickJoinCode({ gid }: Props) {
  const { group } = useGroup(gid);
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (group) {
      setCurrentCode(group.inviteCode);
    }
  }, [group]);

  const handleRotate = async () => {
    setError(null);
    setRotating(true);
    try {
      const { inviteCode } = await apiPost<{ inviteCode: string }>(
        `/api/groups/${gid}/invite/rotate`,
        undefined,
      );
      setCurrentCode(inviteCode);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message || "Failed to generate a new code."
          : "Something went wrong.",
      );
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="space-y-3">
      {currentCode ? (
        <p className="font-mono text-lg tracking-widest text-cream">
          {currentCode}
        </p>
      ) : (
        <p className="text-body-sm text-cream-muted">No code yet.</p>
      )}
      <p className="text-body-sm text-cream-muted">
        Share this code with someone you want to invite. They can join at{" "}
        <span className="font-mono text-xs">/join?code={currentCode ?? "…"}</span>
        . Anyone who knows the code can join — generate a new code if you need
        to revoke access.
      </p>
      <Button
        type="button"
        variant="secondary"
        onClick={() => void handleRotate()}
        loading={rotating}
        disabled={rotating}
      >
        {rotating ? "Generating…" : "Generate new code"}
      </Button>
      {error && <Banner tone="error">{error}</Banner>}
    </div>
  );
}
