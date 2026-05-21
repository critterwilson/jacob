"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Input, Textarea } from "@/components/ui";

export function buildInviteMessage(
  groupName: string,
  inviteUrl: string,
  recipientName: string,
  personalNote: string,
): string {
  const greeting = recipientName.trim()
    ? `Hi ${recipientName.trim()}!`
    : "Hi there!";
  const lines = [
    greeting,
    "",
    `I'd love for you to join ${groupName}, our group on JACOB. It's a place for us to stay connected, share prayer requests, and encourage each other.`,
  ];
  if (personalNote.trim()) {
    lines.push("", personalNote.trim());
  }
  lines.push("", `Here's your invite link: ${inviteUrl}`, "");
  lines.push(
    "Once you sign up, an admin will approve you and you'll be in!",
  );
  return lines.join("\n");
}

type Props = {
  groupName: string;
  inviteUrl: string;
  onClose: () => void;
};

export function InviteMessagePanel({ groupName, inviteUrl, onClose }: Props) {
  const [recipientName, setRecipientName] = useState("");
  const [personalNote, setPersonalNote] = useState("");
  const [copied, setCopied] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function";

  const message = buildInviteMessage(
    groupName,
    inviteUrl,
    recipientName,
    personalNote,
  );

  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (!canShare) return;
    try {
      await navigator.share({ text: message });
    } catch {
      // user cancelled
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      role="dialog"
      aria-modal
      aria-label="Share invite message"
    >
      <div className="w-full max-w-md space-y-4 rounded-t-2xl border border-line bg-ink-raised p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-body font-semibold text-cream">
            Share invite
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded text-cream-muted transition-colors hover:text-cream focus:outline-none focus-visible:shadow-glow-gold"
          >
            ✕
          </button>
        </div>

        <Input
          label="Recipient first name (optional)"
          placeholder="e.g. Sarah"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
        />

        <Textarea
          label="Personal note (optional)"
          placeholder="e.g. We'd love to have you — we meet on Thursdays."
          value={personalNote}
          onChange={(e) => setPersonalNote(e.target.value)}
          rows={2}
        />

        <div>
          <p className="mb-1.5 font-sans text-caption uppercase tracking-wider text-cream-muted">
            Preview
          </p>
          <pre
            className="whitespace-pre-wrap rounded border border-line bg-ink p-3 font-sans text-body-sm text-cream"
            data-testid="message-preview"
          >
            {message}
          </pre>
        </div>

        <div className="flex gap-2">
          <Button
            variant="primary"
            size="md"
            fullWidth={!canShare}
            onClick={() => void copy()}
          >
            {copied ? "Copied!" : "Copy message"}
          </Button>
          {canShare && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => void share()}
              data-testid="share-button"
            >
              Share
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
