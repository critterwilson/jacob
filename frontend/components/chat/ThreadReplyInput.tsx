"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const schema = z.object({
  body: z
    .string()
    .min(1, "Reply cannot be empty")
    .max(4000, "Reply must be 4000 characters or less"),
  alsoPostToChannel: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  gid: string;
  parentMessageId: string;
  parentStickerIds: string[];
};

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

const replyTextareaClass =
  "block w-full resize-none rounded-2xl border border-line bg-ink-overlay px-3 py-2.5 " +
  "font-sans text-body text-cream placeholder:text-cream-muted " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";

export function ThreadReplyInput({
  gid,
  parentMessageId,
  parentStickerIds,
}: Props) {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { body: "", alsoPostToChannel: false },
  });

  const bodyValue = watch("body");
  const alsoPost = watch("alsoPostToChannel");

  // Auto-grow the textarea up to 6 lines, same algorithm as MentionInput.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cs = window.getComputedStyle?.(ta);
    const lh = cs ? parseFloat(cs.lineHeight) || 0 : 0;
    if (!lh) return;
    const paddingY =
      (parseFloat(cs?.paddingTop || "0") || 0) +
      (parseFloat(cs?.paddingBottom || "0") || 0);
    const borderY =
      (parseFloat(cs?.borderTopWidth || "0") || 0) +
      (parseFloat(cs?.borderBottomWidth || "0") || 0);
    ta.style.height = "auto";
    const contentH = ta.scrollHeight - paddingY;
    const cappedContentH = Math.min(contentH, lh * 6);
    ta.style.height = `${cappedContentH + paddingY + borderY}px`;
    ta.style.overflowY = contentH > lh * 6 ? "auto" : "hidden";
  }, [bodyValue]);

  useEffect(() => {
    if (bodyValue === "") {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.style.height = "";
      ta.style.overflowY = "hidden";
    }
  }, [bodyValue]);

  const onSubmit = async (values: FormValues) => {
    if (!user) return;

    const trimmed = values.body.trim();
    const snapshot = { body: values.body, alsoPost: values.alsoPostToChannel };

    // Optimistic clear so the next reply can be typed without waiting.
    reset({ body: "", alsoPostToChannel: false });

    setSending(true);
    setError(null);

    try {
      await apiPost(`/api/groups/${gid}/messages`, {
        body: trimmed,
        stickerIds: parentStickerIds,
        mediaRefs: [],
        parentMessageId,
        mentions: [],
      });

      if (snapshot.alsoPost) {
        await apiPost(`/api/groups/${gid}/messages`, {
          body: trimmed,
          stickerIds: parentStickerIds,
          mediaRefs: [],
          parentMessageId: null,
          mentions: [],
          repostOfThread: parentMessageId,
        });
      }
    } catch (err) {
      reset({ body: snapshot.body, alsoPostToChannel: snapshot.alsoPost });
      if (err instanceof ApiError && err.code === "archived") {
        setError("This group is archived. Replies are disabled.");
      } else {
        setError("Failed to send reply. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit(onSubmit)();
    }
  };

  const hasContent = bodyValue.trim().length > 0;
  const { ref: rhfRef, onChange: rhfOnChange, ...rhfRest } = register("body");

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="Reply to thread"
      className="border-t border-line bg-ink px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]"
    >
      <div className="flex items-end gap-1.5">
        <textarea
          ref={(el) => {
            rhfRef(el);
            textareaRef.current = el;
          }}
          aria-label="Reply body"
          placeholder="Reply…"
          rows={1}
          maxLength={4000}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
            void rhfOnChange(e);
          }}
          onKeyDown={handleKeyDown}
          {...rhfRest}
          className={replyTextareaClass}
        />
        <button
          type="submit"
          aria-label={sending ? "Sending reply" : "Send reply"}
          aria-busy={sending || undefined}
          aria-disabled={!hasContent || undefined}
          disabled={sending}
          className={
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full " +
            "transition-all duration-fast " +
            "focus:outline-none focus-visible:shadow-glow-gold " +
            "disabled:cursor-not-allowed " +
            (hasContent
              ? "bg-gold text-ink hover:bg-gold-soft active:bg-gold-deep"
              : "bg-ink-overlay text-cream-muted hover:text-cream")
          }
        >
          <SendIcon className="h-5 w-5" />
          <span className="sr-only">{sending ? "Sending…" : "Reply"}</span>
        </button>
      </div>

      <label className="mt-2 flex cursor-pointer items-center gap-2 px-1 text-caption text-cream-muted">
        <input
          type="checkbox"
          {...register("alsoPostToChannel")}
          className="h-3.5 w-3.5 accent-gold focus:outline-none focus-visible:shadow-glow-gold"
        />
        Also post to channel
        {alsoPost && (
          <span className="text-gold-soft">— this reply will appear in chat too</span>
        )}
      </label>

      {errors.body && (
        <p role="alert" className="mt-2 px-1 text-caption text-terracotta">
          {errors.body.message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 px-1 text-caption text-terracotta">
          {error}
        </p>
      )}
    </form>
  );
}
