"use client";

import { useState } from "react";

import { Banner, Button } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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
      if (isArchived) {
        await apiPost(`/api/groups/${gid}/unarchive`, undefined);
      } else {
        await apiPost(`/api/groups/${gid}/archive`, { reason });
      }
      setOpen(false);
      setReason("");
      onDone?.();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "archive_too_old") {
          setError(
            "The 60-day unarchive window has expired. Contact an admin to restore.",
          );
        } else {
          setError(e.message || "Something went wrong.");
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
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
