"use client";

import { useState } from "react";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Props = {
  gid: string;
  joinMode: "open" | "request";
  onJoined?: () => void;
};

type JoinResponse = { joined?: boolean; pending?: boolean };

export function JoinRequestButton({ gid, joinMode, onJoined }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [showMessage, setShowMessage] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    setState("pending");
    setErrorMsg(null);
    try {
      const data = await apiPost<JoinResponse>(
        `/api/groups/${gid}/join-requests`,
        { message },
      );
      if (data.joined) {
        setState("done");
        onJoined?.();
      } else {
        setState("done");
      }
    } catch (e) {
      setErrorMsg(
        e instanceof ApiError ? e.message || "Failed to join." : "Network error.",
      );
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <p className="text-sm font-medium text-green-700">
        {joinMode === "open" ? "Joined!" : "Request sent — awaiting approval."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {joinMode === "request" && showMessage && (
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={280}
          placeholder="Optional message to the leader…"
          className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
          rows={2}
        />
      )}
      <div className="flex items-center gap-2">
        {joinMode === "request" && !showMessage ? (
          <button
            type="button"
            onClick={() => setShowMessage(true)}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Request to join
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={state === "pending"}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {state === "pending" ? "…" : joinMode === "open" ? "Join" : "Send request"}
          </button>
        )}
      </div>
      {(state === "error") && errorMsg && (
        <p role="alert" className="text-sm text-red-600">{errorMsg}</p>
      )}
    </div>
  );
}
