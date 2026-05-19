/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── shared mocks ────────────────────────────────────────────────────────────

const mockReplace = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

const { mockGetIdToken, stableAuth } = vi.hoisted(() => {
  const getIdToken = vi.fn().mockResolvedValue("fake-token");
  return {
    mockGetIdToken: getIdToken,
    stableAuth: {
      user: {
        uid: "alice",
        email: "alice@example.com",
        getIdToken,
      },
      loading: false,
      signOut: vi.fn(),
    },
  };
});
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => stableAuth,
}));

// ── snippet sanitiser ───────────────────────────────────────────────────────

import { escapeHtml, sanitiseSnippet } from "@/lib/search-snippet";

describe("sanitiseSnippet", () => {
  it("escapes <script> tags", () => {
    expect(sanitiseSnippet("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("preserves <mark> wrappers from Typesense", () => {
    expect(sanitiseSnippet("hello <mark>world</mark>")).toBe(
      "hello <mark>world</mark>",
    );
  });

  it("escapes attempted attribute injection inside mark", () => {
    expect(sanitiseSnippet('<mark onclick="x">a</mark>')).not.toContain(
      'onclick="x"',
    );
  });

  it("escapes ampersands and quotes", () => {
    expect(escapeHtml("a&b\"c'd")).toBe("a&amp;b&quot;c&#39;d");
  });
});

// ── SearchResultRow ─────────────────────────────────────────────────────────

import { SearchResultRow } from "@/components/search/SearchResultRow";

describe("SearchResultRow", () => {
  it("renders a hit with mark highlighting and a link to the message", () => {
    render(
      <SearchResultRow
        hit={{
          messageRef: "groups/g1/messages/m1",
          groupId: "g1",
          authorUid: "alice",
          authorDisplayName: "Alice",
          body: "hello <mark>world</mark>",
          createdAt: "2026-05-02T12:00:00Z",
          parentMessageId: null,
        }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/groups/g1/chat#m-m1");
    expect(link.querySelector("mark")?.textContent).toBe("world");
  });

  it("does NOT render injected <script> as HTML", () => {
    render(
      <SearchResultRow
        hit={{
          messageRef: "groups/g1/messages/m1",
          groupId: "g1",
          authorUid: "alice",
          authorDisplayName: "Alice",
          body: "<script>window.evil=1</script>",
          createdAt: "2026-05-02T12:00:00Z",
          parentMessageId: null,
        }}
      />,
    );
    expect(screen.getByRole("link").querySelector("script")).toBeNull();
    expect(screen.getByRole("link").textContent).toContain("<script>");
  });
});

// ── useSearch ───────────────────────────────────────────────────────────────

import { useSearch } from "@/lib/hooks/useSearch";
import { renderHook } from "@testing-library/react";

function makeFetchOk(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", makeFetchOk({ hits: [], total: 0, page: 1, limit: 8 }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useSearch", () => {
  it("does not fetch for an empty query", async () => {
    const fetchMock = makeFetchOk({ hits: [], total: 0, page: 1, limit: 8 });
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useSearch(""));
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("debounces fetches by 300ms after the query changes", async () => {
    const fetchMock = makeFetchOk({ hits: [], total: 0, page: 1, limit: 8 });
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useSearch("hi"));

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("/api/v1/search");
    expect(calledUrl).toContain("q=hi");
  });
});

// ── SearchBar (Cmd-K modal) ─────────────────────────────────────────────────

import { SearchBar } from "@/components/search/SearchBar";

describe("SearchBar", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("is hidden by default and opens on Cmd-K", () => {
    render(<SearchBar />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(
      screen.getByRole("dialog", { name: /search messages/i }),
    ).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(<SearchBar />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Enter submits and routes to /search?q=...", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = screen.getByLabelText(/search query/i);
    await user.type(input, "rejoice");
    await user.keyboard("{Enter}");
    expect(mockPush).toHaveBeenCalledWith("/search?q=rejoice");
  });
});
