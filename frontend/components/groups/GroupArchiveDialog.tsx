"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

type Props = {
  gid: string;
  isArchived: boolean;
  onDone?: () => void;
};

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
          setError("The 60-day unarchive window has expired. Contact an admin to restore.");
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded border px-3 py-1.5 text-sm ${
          isArchived
            ? "border-green-300 text-green-700 hover:bg-green-50"
            : "border-red-300 text-red-700 hover:bg-red-50"
        }`}
      >
        {isArchived ? "Unarchive group" : "Archive group"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 id="archive-dialog-title" className="mb-3 text-lg font-semibold">
              {isArchived ? "Unarchive group?" : "Archive group?"}
            </h2>

            {isArchived ? (
              <p className="mb-4 text-sm text-gray-600">
                This will re-enable messaging. Members can post again immediately.
              </p>
            ) : (
              <>
                <p className="mb-4 text-sm text-gray-600">
                  Archiving makes the group read-only for everyone. You can unarchive within
                  60 days. After that, an admin must restore it.
                </p>
                <label className="block text-sm font-medium text-gray-700">
                  Reason (optional)
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="mt-1 block w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              </>
            )}

            {error && (
              <p role="alert" className="mb-3 text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={loading}
                className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  isArchived ? "bg-green-600" : "bg-red-600"
                }`}
              >
                {loading ? "…" : isArchived ? "Unarchive" : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
