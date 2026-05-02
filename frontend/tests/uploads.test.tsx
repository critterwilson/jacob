/**
 * @vitest-environment jsdom
 *
 * T10 — frontend tests for `useUploadPhoto` and `PhotoAttachButton`.
 *
 * The hook orchestrates three HTTP calls:
 *   1. POST /api/uploads/photos       (signed URL)
 *   2. PUT  <signed url>              (bytes to GCS)
 *   3. POST /api/uploads/{id}/finalize (moderation, returns publicUrl)
 *
 * We mock `fetch` and walk the state machine for happy / oversize /
 * SafeSearch-fail / CSAM-hit cases.
 */
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
// `act` is left in the imports for parity with the project's other tests
// that do double-duty as React rendering harnesses.
void act;
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

const mockGetIdToken = vi.fn().mockResolvedValue("fake-token");
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      uid: "alice",
      email: "alice@example.com",
      getIdToken: mockGetIdToken,
    },
    loading: false,
    signOut: vi.fn(),
  }),
}));

import { PhotoAttachButton } from "@/components/chat/PhotoAttachButton";
import {
  MAX_PHOTO_BYTES,
  UploadError,
  useUploadPhoto,
} from "@/lib/hooks/useUploadPhoto";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function makeFile({
  name = "photo.jpg",
  type = "image/jpeg",
  size = 50_000,
}: { name?: string; type?: string; size?: number } = {}): File {
  // Synthesize a File of the requested size without actually allocating bytes.
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

// Awaiting an upload that throws inside `act` makes TS narrow `caught` back
// to its initial `null`. `captureUploadError` works around that by returning
// the rejected error directly with a precise type.
async function captureUploadError(fn: () => Promise<unknown>): Promise<UploadError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof UploadError) return err;
    throw err;
  }
  throw new Error("expected upload to throw an UploadError");
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  mockGetIdToken.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── useUploadPhoto: happy path ───────────────────────────────────────────────

describe("useUploadPhoto", () => {
  it("walks signed-URL → PUT → finalize and returns publicUrl on pass", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { uploadId: "u1", uploadUrl: "https://signed/PUT", expiresAt: "x" },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { publicUrl: "https://cdn/public/u1.jpg" },
          { status: 200 },
        ),
      );

    const { result } = renderHook(() => useUploadPhoto());

    let url = "";
    await act(async () => {
      url = await result.current.upload({
        file: makeFile(),
        purpose: "message",
        groupId: "g1",
      });
    });

    expect(url).toBe("https://cdn/public/u1.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/uploads/photos");
    expect(fetchMock.mock.calls[1][0]).toBe("https://signed/PUT");
    expect(fetchMock.mock.calls[2][0]).toContain("/api/uploads/u1/finalize");
  });

  it("rejects oversize files before contacting the backend", async () => {
    const { result } = renderHook(() => useUploadPhoto());
    const big = makeFile({ size: MAX_PHOTO_BYTES + 1 });

    await expect(
      result.current.upload({ file: big, purpose: "avatar" }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported mime types before contacting the backend", async () => {
    const { result } = renderHook(() => useUploadPhoto());
    const gif = makeFile({ type: "image/gif", name: "a.gif" });

    const err = await captureUploadError(() =>
      result.current.upload({ file: gif, purpose: "avatar" }),
    );
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe("invalid_mime");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires groupId for message uploads", async () => {
    const { result } = renderHook(() => useUploadPhoto());
    const err = await captureUploadError(() =>
      result.current.upload({ file: makeFile(), purpose: "message" }),
    );
    expect(err.code).toBe("missing_group");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces SafeSearch rejection as `safesearch_blocked`", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { uploadId: "u2", uploadUrl: "https://signed/PUT2", expiresAt: "x" },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "safesearch_blocked",
              message: "blocked",
              details: { reason: "adult" },
            },
          },
          { status: 422 },
        ),
      );

    const { result } = renderHook(() => useUploadPhoto());
    const err = await captureUploadError(() =>
      result.current.upload({ file: makeFile(), purpose: "avatar" }),
    );
    expect(err.code).toBe("safesearch_blocked");
  });

  it("surfaces CSAM hit as `csam_hash_match`", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { uploadId: "u3", uploadUrl: "https://signed/PUT3", expiresAt: "x" },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "csam_hash_match", message: "blocked", details: {} } },
          { status: 451 },
        ),
      );

    const { result } = renderHook(() => useUploadPhoto());
    const err = await captureUploadError(() =>
      result.current.upload({ file: makeFile(), purpose: "avatar" }),
    );
    expect(err.code).toBe("csam_hash_match");
  });

  it("surfaces 403 from create as `forbidden`", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "forbidden", message: "no", details: {} } },
        { status: 403 },
      ),
    );

    const { result } = renderHook(() => useUploadPhoto());
    const err = await captureUploadError(() =>
      result.current.upload({
        file: makeFile(),
        purpose: "message",
        groupId: "g1",
      }),
    );
    expect(err.code).toBe("forbidden");
    // No PUT happened
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── PhotoAttachButton ───────────────────────────────────────────────────────

describe("PhotoAttachButton", () => {
  it("calls onAttach with the public URL on success", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { uploadId: "u1", uploadUrl: "https://signed/PUT", expiresAt: "x" },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { publicUrl: "https://cdn/public/u1.jpg" },
          { status: 200 },
        ),
      );

    const onAttach = vi.fn();
    render(<PhotoAttachButton gid="g1" onAttach={onAttach} />);

    const input = screen.getByTestId("photo-attach-input") as HTMLInputElement;
    const file = makeFile();
    await userEvent.upload(input, file);

    await waitFor(() =>
      expect(onAttach).toHaveBeenCalledWith("https://cdn/public/u1.jpg"),
    );
  });

  it("shows an inline error message on rejection", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { uploadId: "u1", uploadUrl: "https://signed/PUT", expiresAt: "x" },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "safesearch_blocked",
              message: "blocked",
              details: { reason: "adult" },
            },
          },
          { status: 422 },
        ),
      );

    render(<PhotoAttachButton gid="g1" onAttach={vi.fn()} />);

    const input = screen.getByTestId("photo-attach-input") as HTMLInputElement;
    await userEvent.upload(input, makeFile());

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(/safety review/i);
  });
});
