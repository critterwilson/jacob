"use client";

import { useState } from "react";

import { Banner, Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

type Props = {
  gid: string;
  isArchived: boolean;
  onDone?: () => void;
};

const reasonTextareaClass =
  "mt-1 block w-full resize-none rounded border border-line bg-ink-overlay px-3 py-2 " +
  "font-sans text-body text-cream placeholder:text-cream-dim " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";

export function GroupArchiveDialog({ gid, isArchived, onDone }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const endpoint = isArchived
        ? `${apiBase()}/api/groups/${gid}/unarchive`
        : `${apiBase()}/api/groups/${gid}/archive`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: isArchived ? undefined : JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; code?: string };
        } | null;
        const code = body?.error?.code;
        if (code === "archive_too_old") {
          setError(
            "The 60-day unarchive window has expired. Contact an admin to restore.",
          );
        } else {
          setError(body?.error?.message ?? "Something went wrong.");
        }
        return;
      }
      setOpen(false);
      setReason("");
      onDone?.();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={isArchived ? "secondary" : "destructive"}
        size="md"
        onClick={() => setOpen(true)}
      >
        {isArchived ? "Unarchive group" : "Archive group"}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-ink-overlay p-6 shadow-pop">
            <h2
              id="archive-dialog-title"
              className="mb-3 font-display text-display-sm text-cream"
            >
              {isArchived ? "Unarchive group?" : "Archive group?"}
            </h2>

            {isArchived ? (
              <p className="mb-4 text-body-sm text-cream-muted">
                This will re-enable messaging. Members can post again
                immediately.
              </p>
            ) : (
              <>
                <p className="mb-4 text-body-sm text-cream-muted">
                  Archiving makes the group read-only for everyone. You can
                  unarchive within 60 days. After that, an admin must restore
                  it.
                </p>
                <label className="block text-label text-cream">
                  Reason (optional)
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className={reasonTextareaClass}
                  />
                </label>
              </>
            )}

            {error && (
              <div className="mt-4">
                <Banner tone="error">{error}</Banner>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={isArchived ? "primary" : "destructive"}
                size="md"
                onClick={() => void handleConfirm()}
                loading={loading}
                disabled={loading}
              >
                {loading ? "…" : isArchived ? "Unarchive" : "Archive"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
