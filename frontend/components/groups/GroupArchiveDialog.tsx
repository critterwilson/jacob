"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth-context";

type Props = {
  gid: string;
  isArchived: boolean;
  onSuccess?: () => void;
};

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

export function GroupArchiveDialog({ gid, isArchived, onSuccess }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const endpoint = isArchived ? "unarchive" : "archive";
      const res = await fetch(`${apiBase()}/api/groups/${gid}/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: isArchived ? undefined : JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Operation failed. Please try again.");
        return;
      }
      setOpen(false);
      setReason("");
      onSuccess?.();
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded border px-3 py-1.5 text-sm font-medium ${
          isArchived
            ? "border-blue-300 text-blue-700 hover:bg-blue-50"
            : "border-red-300 text-red-700 hover:bg-red-50"
        }`}
      >
        {isArchived ? "Unarchive group" : "Archive group"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isArchived ? "Unarchive group" : "Archive group"}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-semibold">
              {isArchived ? "Unarchive group?" : "Archive group?"}
            </h2>

            {isArchived ? (
              <p className="mb-4 text-sm text-gray-600">
                Unarchiving will re-enable messages for all members. Groups can only be
                unarchived within 60 days of archival.
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-gray-600">
                  Archiving disables new messages. Existing content stays visible.
                  You can unarchive within 60 days.
                </p>
                <label
                  htmlFor="archive-reason"
                  className="block text-sm font-medium text-gray-700"
                >
                  Reason (optional)
                </label>
                <textarea
                  id="archive-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Optional reason…"
                  className="mt-1 w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </>
            )}

            {error && (
              <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null); }}
                className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={loading}
                className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  isArchived ? "bg-blue-600 hover:bg-blue-700" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {loading
                  ? isArchived ? "Unarchiving…" : "Archiving…"
                  : isArchived ? "Unarchive" : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
