"use client";

import { type ReactNode } from "react";

import { Button } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";
import { usePWAInstall } from "@/lib/hooks/usePWAInstall";

// iOS Share icon: square with up-arrow, exactly as it appears in Safari's toolbar.
function ShareIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline h-[1em] w-[1em] align-[-0.125em]"
      aria-hidden
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold text-[11px] font-bold leading-none text-ink">
        {n}
      </span>
      <span className="text-cream">{children}</span>
    </li>
  );
}

export function InstallPrompt() {
  const {
    canInstall,
    promptInstall,
    dismiss,
    permanentDismiss,
    dismissed,
    isStandalone,
    platform,
  } = usePWAInstall();

  if (isStandalone) return null;
  if (dismissed) return null;
  // Render nothing until the client useEffect has detected the platform
  // so the initial server-rendered HTML and the first client render agree.
  if (platform === "unknown") return null;
  // Desktop: only worth surfacing when the native prompt is ready.
  if (platform === "desktop" && !canInstall) return null;

  return (
    <div
      role="banner"
      className="rounded-lg border border-line bg-ink-raised px-4 py-4 text-sm"
    >
      <p className="mb-2 font-semibold text-cream">{`Install ${BRAND_NAME}`}</p>

      {platform === "ios-safari" && (
        <>
          <p className="mb-3 text-cream-muted">
            {`Add ${BRAND_NAME} to your Home Screen for the full app experience.`}
          </p>
          <ol className="mb-4 space-y-2">
            <Step n={1}>
              Tap the <ShareIcon /> <strong>Share</strong> button at the bottom
              of Safari
            </Step>
            <Step n={2}>
              Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>
            </Step>
            <Step n={3}>
              Tap <strong>&ldquo;Add&rdquo;</strong> in the top-right corner
            </Step>
          </ol>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismiss}
            >
              Not now
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={permanentDismiss}
            >
              Already installed
            </Button>
          </div>
        </>
      )}

      {platform === "ios-other" && (
        <>
          <p className="mb-3 text-cream-muted">
            On iPhone, apps can only be added to your Home Screen from Safari.
          </p>
          <ol className="mb-4 space-y-2">
            <Step n={1}>
              Open this page in <strong>Safari</strong>
            </Step>
            <Step n={2}>
              Tap the <ShareIcon /> <strong>Share</strong> button
            </Step>
            <Step n={3}>
              Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>
            </Step>
          </ol>
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                window.location.href =
                  "x-safari-" + window.location.href;
              }}
            >
              Open in Safari
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismiss}
            >
              Not now
            </Button>
          </div>
        </>
      )}

      {platform === "android" && canInstall && (
        <>
          <p className="mb-4 text-cream-muted">
            {`Install ${BRAND_NAME} for a faster, offline-capable experience.`}
          </p>
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void promptInstall()}
            >
              Install
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismiss}
            >
              Not now
            </Button>
          </div>
        </>
      )}

      {platform === "android" && !canInstall && (
        <>
          <p className="mb-3 text-cream-muted">
            {`Add ${BRAND_NAME} to your Home Screen from your browser menu.`}
          </p>
          <ol className="mb-4 space-y-2">
            <Step n={1}>
              Tap the menu button <strong>⋮</strong> in your browser
            </Step>
            <Step n={2}>
              Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong> or{" "}
              <strong>&ldquo;Install app&rdquo;</strong>
            </Step>
          </ol>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismiss}
            >
              Got it
            </Button>
          </div>
        </>
      )}

      {platform === "desktop" && canInstall && (
        <>
          <p className="mb-4 text-cream-muted">
            {`Install ${BRAND_NAME} for faster access and offline support.`}
          </p>
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void promptInstall()}
            >
              Install
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismiss}
            >
              Not now
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
