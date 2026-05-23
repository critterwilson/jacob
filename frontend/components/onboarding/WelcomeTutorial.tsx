"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Button, cn } from "@/components/ui";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useDelayedUnmount } from "@/lib/hooks/useDelayedUnmount";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

type Slide = {
  // Stable id — used as the labelledby target for the dialog while this
  // slide is showing, and as the React key.
  id: string;
  illustration: ReactNode;
  heading: string;
  body: string;
};

const SLIDES: Slide[] = [
  {
    id: "welcome",
    illustration: <SparkIcon />,
    heading: "Welcome to JACOB",
    body: "A quiet space for your group to stay connected — talk together, share, and grow in scripture.",
  },
  {
    id: "groups",
    illustration: <GroupsIcon />,
    heading: "Your group is home base",
    body: "Open the Groups tab to chat, reply in threads, see who's in the group, and share photos. Most of the day-to-day happens here.",
  },
  {
    id: "stickers",
    illustration: <StickerIcon />,
    heading: "Tag messages with a sticker",
    body: "When you post, add up to two stickers — Prayer, Praise, Question, and more — to share why you're sharing. It's small, but it helps the group respond well.",
  },
  {
    id: "boards",
    illustration: <BoardsIcon />,
    heading: "Boards and your organization",
    body: "Boards carry wider announcements, devotionals, and notes from leaders. Find them in the Boards tab and on your Home page.",
  },
  {
    id: "grow",
    illustration: <GrowIcon />,
    heading: "A daily anchor in scripture",
    body: "Home greets you with the verse of the day. Open Grow for devotionals, reading plans, and a way to find more groups.",
  },
  {
    id: "tabs",
    illustration: <TabsIcon />,
    heading: "Getting around",
    body: "The tabs at the bottom — Home, Groups, Boards, Grow — are everything you need day to day. Your profile lives behind your avatar at the top.",
  },
  {
    id: "done",
    illustration: <HeartIcon />,
    heading: "You're set",
    body: "That's the tour. You can re-open it anytime from the FAQ page if you'd like a refresher.",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function WelcomeTutorial({ open, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const { render, state } = useDelayedUnmount(open, 180);
  useBodyScrollLock(open);

  // Reset to the first slide every time the dialog is opened so a re-open
  // from the FAQ doesn't drop the user mid-deck.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const trapRef = useFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: onClose,
  });

  const slide = SLIDES[index];
  const isFirst = index === 0;
  const isLast = index === SLIDES.length - 1;
  const labelId = `welcome-tutorial-heading-${slide.id}`;

  const next = useCallback(() => {
    if (isLast) {
      onClose();
      return;
    }
    setIndex((i) => Math.min(i + 1, SLIDES.length - 1));
  }, [isLast, onClose]);

  const back = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  if (!render) return null;

  return (
    <div
      data-state={state}
      // Safe-area padding so the dialog clears the notch / home indicator
      // when it grows tall on small screens.
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-safe-t pb-safe-b pl-safe-l pr-safe-r"
    >
      <button
        type="button"
        aria-label="Dismiss welcome tutorial"
        onClick={onClose}
        className={cn(
          "fixed inset-0 cursor-default bg-black/70 transition-opacity duration-base",
          "focus:outline-none focus-visible:shadow-glow-gold",
          state === "open" ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className={cn(
          "relative flex w-full max-w-md flex-col rounded-2xl border border-line bg-ink-overlay p-6 shadow-pop",
          "transition-all duration-base",
          // Animation is gated by the `duration-base` token, which the
          // global `prefers-reduced-motion: reduce` rule collapses to 0ms
          // (see styles/tokens.css). No extra hook needed here.
          state === "open"
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0",
        )}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-caption text-cream-muted">
            Step {index + 1} of {SLIDES.length}
          </span>
          {!isLast && (
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "rounded font-sans text-caption text-cream-muted underline-offset-4 hover:text-cream hover:underline",
                "focus:outline-none focus-visible:shadow-glow-gold",
              )}
            >
              Skip
            </button>
          )}
        </div>

        <div
          className="my-4 flex h-28 items-center justify-center text-gold"
          aria-hidden="true"
        >
          {slide.illustration}
        </div>

        <h2
          id={labelId}
          className="text-center font-display text-display-sm text-cream"
        >
          {slide.heading}
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-center text-body text-cream-muted">
          {slide.body}
        </p>

        <ol
          className="mx-auto mt-6 flex gap-2"
          aria-label="Tutorial progress"
        >
          {SLIDES.map((s, i) => (
            <li key={s.id} aria-current={i === index ? "step" : undefined}>
              <span
                className={cn(
                  "block h-1.5 w-6 rounded-full transition-colors duration-fast",
                  i === index ? "bg-gold" : "bg-line",
                )}
              />
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:gap-3">
          <Button
            type="button"
            variant="secondary"
            fullWidth="mobile"
            onClick={back}
            disabled={isFirst}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="primary"
            fullWidth="mobile"
            onClick={next}
          >
            {isLast ? "Get started" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Inline SVG illustrations — kept here so the tutorial is fully
// self-contained (no asset pipeline / image bytes through the
// moderation bucket).
// ----------------------------------------------------------------------------

function iconBaseProps() {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-20 w-20",
    "aria-hidden": true,
  };
}

function SparkIcon() {
  return (
    <svg {...iconBaseProps()}>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M5.6 5.6l2.1 2.1" />
      <path d="M16.3 16.3l2.1 2.1" />
      <path d="M5.6 18.4l2.1-2.1" />
      <path d="M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

function GroupsIcon() {
  return (
    <svg {...iconBaseProps()}>
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M15 19c0-2.2 1.8-4 4-4s4 1.8 4 4" />
    </svg>
  );
}

function StickerIcon() {
  return (
    <svg {...iconBaseProps()}>
      <path d="M14 4h-7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      <path d="M14 4l6 6h-4a2 2 0 0 1-2-2z" />
      <circle cx="10" cy="13" r="1.2" />
      <path d="M9 17c.6.7 1.5 1 2 1s1.4-.3 2-1" />
    </svg>
  );
}

function BoardsIcon() {
  return (
    <svg {...iconBaseProps()}>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 13h6" />
      <path d="M8 16h4" />
    </svg>
  );
}

function GrowIcon() {
  return (
    <svg {...iconBaseProps()}>
      <path d="M12 21V9" />
      <path d="M12 9c0-3 2-6 6-6 0 4-3 6-6 6z" />
      <path d="M12 13c0-2.5-1.7-5-5-5 0 3.3 2.2 5 5 5z" />
      <path d="M5 21h14" />
    </svg>
  );
}

function TabsIcon() {
  return (
    <svg {...iconBaseProps()}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 16h18" />
      <circle cx="7.5" cy="18" r="0.8" />
      <circle cx="11" cy="18" r="0.8" />
      <circle cx="14.5" cy="18" r="0.8" />
      <circle cx="18" cy="18" r="0.8" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg {...iconBaseProps()}>
      <path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z" />
    </svg>
  );
}
