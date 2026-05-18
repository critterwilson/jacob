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

const GROUP_AT_CAP_MSG =
  "This group has reached its member limit. The group leader can raise the cap to add more members.";

export function JoinRequestButton({ gid, joinMode, onJoined }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<"idle" | "pending" | "done" | "error" | "at_cap">("idle");
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
      if (e instanceof ApiError && e.code === "group_at_cap") {
        setState("at_cap");
        return;
      }
      setErrorMsg(
        e instanceof ApiError ? e.message || "Failed to join." : "Network error.",
      );
      setState("error");
    }
  };

  if (state === "at_cap") {
    return (
      <p role="alert" className="text-sm text-cream-muted">
        {GROUP_AT_CAP_MSG}
      </p>
    );
  }

  if (state === "done") {
    return (
      <p className="text-sm font-medium text-sage">
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
          className="w-full rounded border border-line bg-ink-raised px-3 py-2 text-sm text-cream placeholder:text-cream-dim focus:outline-none focus-visible:shadow-glow-gold"
          rows={2}
        />
      )}
      <div className="flex items-center gap-2">
        {joinMode === "request" && !showMessage ? (
          <button
            type="button"
            onClick={() => setShowMessage(true)}
            className="rounded bg-gold px-4 py-1.5 text-sm font-medium text-ink hover:bg-gold-soft"
          >
            Request to join
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={state === "pending"}
            className="rounded bg-gold px-4 py-1.5 text-sm font-medium text-ink hover:bg-gold-soft disabled:opacity-50"
          >
            {state === "pending" ? "…" : joinMode === "open" ? "Join" : "Send request"}
          </button>
        )}
      </div>
      {state === "error" && errorMsg && (
        <p role="alert" className="text-sm text-terracotta">{errorMsg}</p>
      )}
    </div>
  );
}
