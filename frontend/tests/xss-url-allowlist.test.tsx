/**
 * @vitest-environment jsdom
 *
 * H-FRONT-2 regression: every place we render a user/leader-controlled
 * URL into an `<a href>`, `<img src>`, or `<iframe src>` must drop
 * `javascript:` payloads silently rather than rendering them.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
  rtdb: {},
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
  apiPost: vi.fn().mockResolvedValue({}),
  apiPatch: vi.fn().mockResolvedValue({}),
  apiDelete: vi.fn().mockResolvedValue({}),
  apiGetConditional: vi.fn().mockResolvedValue({ data: null, etag: null }),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ gid: "g1", sermonId: "s1", sessionId: "ws1" }),
}));

import { UnfurlCard } from "@/components/chat/UnfurlCard";
import { PhotoView } from "@/components/chat/PhotoView";
import { useGroupSermons } from "@/lib/hooks/useGroupSermons";
import { useWatchSession } from "@/lib/hooks/useWatchSession";
import { useAuth } from "@/lib/auth-context";

vi.mock("@/lib/hooks/useGroupSermons", () => ({
  useGroupSermons: vi.fn(),
}));

vi.mock("@/lib/hooks/useWatchSession", () => ({
  useWatchSession: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: vi.fn(),
}));

import SermonDetailPage from "@/app/groups/[gid]/sermons/[sermonId]/page";
import SermonsListPage from "@/app/groups/[gid]/sermons/page";
import WatchSessionPage from "@/app/groups/[gid]/watch/[sessionId]/page";

const mockedUseGroupSermons = useGroupSermons as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUseWatchSession = useWatchSession as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

const JS_URL = "javascript:alert(1)";
const DATA_HTML = "data:text/html,<script>alert(1)</script>";

const malicious = (id: string) => ({
  sermonId: id,
  title: "Malicious",
  preacher: null,
  scripture: null,
  sermonDate: null,
  sourceUrl: JS_URL,
  sourceType: "other" as const,
  thumbnail: JS_URL,
  addedBy: "u1",
  addedAt: null,
  deletedAt: null,
});

describe("UnfurlCard XSS allowlist (H-FRONT-2)", () => {
  it("renders nothing when the unfurl url is javascript:", () => {
    const { container } = render(
      <UnfurlCard
        unfurl={{
          url: JS_URL,
          title: "evil",
          description: null,
          imageUrl: null,
          siteName: null,
        }}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders link but drops img when only imageUrl is malicious", () => {
    const { container } = render(
      <UnfurlCard
        unfurl={{
          url: "https://example.com/article",
          title: "Article",
          description: null,
          imageUrl: JS_URL,
          siteName: null,
        }}
      />,
    );
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "https://example.com/article");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("PhotoView XSS allowlist (H-FRONT-2)", () => {
  it("renders nothing for a javascript: src", () => {
    const { container } = render(<PhotoView src={JS_URL} alt="x" />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders nothing for a data:text/html src", () => {
    const { container } = render(<PhotoView src={DATA_HTML} alt="x" />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("Sermon detail page XSS allowlist (H-FRONT-2)", () => {
  it("drops <a href> and <img src> for javascript: payloads", () => {
    mockedUseGroupSermons.mockReturnValue({
      sermons: [malicious("s1")],
      preachers: [],
      loading: false,
      error: null,
      addSermon: vi.fn(),
      deleteSermon: vi.fn(),
    });
    const { container } = render(<SermonDetailPage />);
    // No anchor with the javascript: URL
    const anchors = Array.from(container.querySelectorAll("a"));
    for (const a of anchors) {
      expect(a.getAttribute("href")).not.toBe(JS_URL);
    }
    // No <img> at all (the only one is the malicious thumbnail)
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("Sermon list page XSS allowlist (H-FRONT-2)", () => {
  it("drops <img src> for javascript: thumbnails", () => {
    mockedUseGroupSermons.mockReturnValue({
      sermons: [malicious("s1"), malicious("s2")],
      preachers: [],
      loading: false,
      error: null,
      addSermon: vi.fn(),
      deleteSermon: vi.fn(),
    });
    const { container } = render(<SermonsListPage />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("Watch session page XSS allowlist (H-FRONT-2)", () => {
  it("drops the YouTube link and encodeURIComponent's the videoId for the iframe", () => {
    mockedUseAuth.mockReturnValue({ user: { uid: "alice" } });
    mockedUseWatchSession.mockReturnValue({
      session: {
        sessionId: "ws1",
        videoId: "abc/../evil?injected",
        sourceUrl: JS_URL,
        title: "Hacked",
        thumbnailUrl: null,
        leaderUid: "alice",
        createdBy: "alice",
        createdAt: null,
        endedAt: null,
        attendees: ["alice"],
        durationSec: null,
      },
      loading: false,
      join: vi.fn().mockResolvedValue(true),
      end: vi.fn(),
      transfer: vi.fn(),
    });
    const { container } = render(<WatchSessionPage />);
    // No anchor with the javascript: URL
    const anchors = Array.from(container.querySelectorAll("a"));
    for (const a of anchors) {
      expect(a.getAttribute("href")).not.toBe(JS_URL);
    }
    // iframe src must encodeURIComponent the videoId — slash, ?, and .. all escaped
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const src = iframe!.getAttribute("src") ?? "";
    expect(src).toContain(encodeURIComponent("abc/../evil?injected"));
    expect(src).not.toContain("abc/../evil?injected");
    // Sandbox is applied
    expect(iframe).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
  });
});
