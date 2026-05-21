/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
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
  useParams: vi.fn(() => ({ gid: "g1", sermonId: "s1" })),
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: vi.fn(() => ({ user: { uid: "u1" }, loading: false })),
}));

vi.mock("@/lib/hooks/useGroupMembership", () => ({
  useGroupMembership: vi.fn(() => ({
    membership: null,
    isLeader: false,
    loading: false,
  })),
}));

import {
  apiDelete as apiDeleteExport,
  apiGet as apiGetExport,
  apiPost as apiPostExport,
  apiPatch as apiPatchExport,
} from "@/lib/api";
import { useGroupSermons } from "@/lib/hooks/useGroupSermons";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { safeHttpUrl } from "@/lib/safeUrl";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;
const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;
const apiDelete = apiDeleteExport as unknown as ReturnType<typeof vi.fn>;
const apiPatch = apiPatchExport as unknown as ReturnType<typeof vi.fn>;
const mockUseGroupMembership = useGroupMembership as unknown as ReturnType<typeof vi.fn>;

const SERMON = {
  sermonId: "s1",
  title: "Sermon",
  preacher: "Pastor Jane",
  scripture: null,
  sermonDate: null,
  sourceUrl: "https://example.com",
  sourceType: "other" as const,
  thumbnail: null,
  addedBy: "u1",
  addedAt: null,
  deletedAt: null,
};

describe("useGroupSermons (T52)", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    apiPatch.mockReset();
  });

  it("loads sermons + preachers", async () => {
    apiGet.mockResolvedValue({
      sermons: [SERMON],
      preachers: ["Pastor Jane"],
    });
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sermons).toHaveLength(1);
    expect(result.current.preachers).toEqual(["Pastor Jane"]);
  });

  it("addSermon posts and reloads", async () => {
    apiGet.mockResolvedValue({ sermons: [], preachers: [] });
    apiPost.mockResolvedValue(SERMON);
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const created = await result.current.addSermon({
      sourceUrl: "https://example.com",
    });
    expect(created?.sermonId).toBe("s1");
    expect(apiPost).toHaveBeenCalledWith("/api/groups/g1/sermons", {
      sourceUrl: "https://example.com",
    });
  });

  it("deleteSermon resolves true on success", async () => {
    apiGet.mockResolvedValue({ sermons: [], preachers: [] });
    apiDelete.mockResolvedValue({});
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(await result.current.deleteSermon("s1")).toBe(true);
    expect(apiDelete).toHaveBeenCalledWith("/api/groups/g1/sermons/s1");
  });

  it("patchSermon sends PATCH and returns updated sermon", async () => {
    apiGet.mockResolvedValue({ sermons: [SERMON], preachers: [] });
    const updated = { ...SERMON, title: "Updated" };
    apiPatch.mockResolvedValue(updated);
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const res = await result.current.patchSermon("s1", { title: "Updated" });
    expect(res?.title).toBe("Updated");
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/groups/g1/sermons/s1",
      { title: "Updated" },
    );
  });
});

describe("safeHttpUrl (URL validation)", () => {
  it("accepts https URLs", () => {
    expect(safeHttpUrl("https://youtube.com/watch?v=abc")).toBe(
      "https://youtube.com/watch?v=abc",
    );
  });

  it("accepts http URLs", () => {
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
  });

  it("rejects javascript: protocol", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects data: URIs", () => {
    expect(safeHttpUrl("data:text/html,<script>")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(safeHttpUrl("")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(safeHttpUrl("not a url at all")).toBeNull();
  });
});

describe("SermonsListPage — leader gating", () => {
  beforeEach(() => {
    apiGet.mockResolvedValue({ sermons: [], preachers: [] });
    apiPost.mockReset();
  });

  it("hides Add sermon button for members", async () => {
    mockUseGroupMembership.mockReturnValue({
      isLeader: false,
      loading: false,
      membership: null,
    });
    const { default: Page } = await import(
      "@/app/(authed)/groups/[gid]/sermons/page"
    );
    render(<Page />);
    expect(screen.queryByRole("button", { name: /add sermon/i })).toBeNull();
  });

  it("shows Add sermon button for leaders", async () => {
    mockUseGroupMembership.mockReturnValue({
      isLeader: true,
      loading: false,
      membership: { role: "leader" },
    });
    const { default: Page } = await import(
      "@/app/(authed)/groups/[gid]/sermons/page"
    );
    render(<Page />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add sermon/i }),
      ).toBeInTheDocument(),
    );
  });

  it("shows URL validation error for non-http input", async () => {
    mockUseGroupMembership.mockReturnValue({
      isLeader: true,
      loading: false,
      membership: { role: "leader" },
    });
    const { default: Page } = await import(
      "@/app/(authed)/groups/[gid]/sermons/page"
    );
    render(<Page />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add sermon/i }));
    const urlInput = await screen.findByRole("textbox", { name: /source url/i });
    await user.type(urlInput, "not-a-url");
    expect(await screen.findByRole("alert")).toHaveTextContent(/http/i);
  });

  it("submit button disabled when URL is invalid", async () => {
    mockUseGroupMembership.mockReturnValue({
      isLeader: true,
      loading: false,
      membership: { role: "leader" },
    });
    const { default: Page } = await import(
      "@/app/(authed)/groups/[gid]/sermons/page"
    );
    render(<Page />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add sermon/i }));
    const urlInput = await screen.findByRole("textbox", { name: /source url/i });
    await user.type(urlInput, "javascript:evil()");
    const addBtn = screen.getByRole("button", { name: /^add$/i });
    expect(addBtn).toBeDisabled();
  });

  it("submits valid URL to addSermon", async () => {
    mockUseGroupMembership.mockReturnValue({
      isLeader: true,
      loading: false,
      membership: { role: "leader" },
    });
    apiPost.mockResolvedValue(SERMON);
    const { default: Page } = await import(
      "@/app/(authed)/groups/[gid]/sermons/page"
    );
    render(<Page />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add sermon/i }));
    const urlInput = await screen.findByRole("textbox", { name: /source url/i });
    await user.type(urlInput, "https://youtube.com/watch?v=test");
    const addBtn = screen.getByRole("button", { name: /^add$/i });
    expect(addBtn).not.toBeDisabled();
    await user.click(addBtn);
    expect(apiPost).toHaveBeenCalledWith(
      "/api/groups/g1/sermons",
      expect.objectContaining({ sourceUrl: "https://youtube.com/watch?v=test" }),
    );
  });
});
