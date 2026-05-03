/**
 * T37 — Unit tests for the photo-variant generation logic.
 *
 * Mocks firebase-admin/app, firebase-admin/storage, and the imageVariants
 * service so no GCS or Firebase calls hit the network.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mock firebase-admin ──────────────────────────────────────────────────────

const mockSave = vi.fn().mockResolvedValue(undefined);
const mockExists = vi.fn();
const mockDownload = vi.fn();

const mockFile = vi.fn((path: string) => ({
  exists: () => mockExists(path),
  save: (buf: Buffer, opts: unknown) => mockSave(path, buf, opts),
  download: () => mockDownload(path),
}));

const mockBucket = vi.fn(() => ({ file: mockFile }));

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}], // prevent initializeApp
  initializeApp: vi.fn(),
}));

vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({ bucket: mockBucket }),
}));

// ── mock firebase-functions/v2/storage ────────────────────────────────────

// Capture the handler when onObjectFinalized is called, expose a `trigger`
// helper so tests can invoke it directly.
type Handler = (event: { data: Record<string, string> }) => Promise<void>;
let capturedHandler: Handler | null = null;

vi.mock("firebase-functions/v2/storage", () => ({
  onObjectFinalized: (_opts: unknown, handler: Handler) => {
    capturedHandler = handler;
    return handler;
  },
}));

// ── mock imageVariants ────────────────────────────────────────────────────────

const FAKE_VARIANTS = {
  w320: Buffer.from("img320"),
  w640: Buffer.from("img640"),
  w1280: Buffer.from("img1280"),
};
const generateVariantsMock = vi.fn().mockResolvedValue(FAKE_VARIANTS);

vi.mock("../services/imageVariants", () => ({
  generateVariants: (...args: unknown[]) => generateVariantsMock(...args),
}));

// ── import module (after mocks) ───────────────────────────────────────────────

await import("../onPhotoUploadFinalize");

function trigger(data: Record<string, string>) {
  if (!capturedHandler) throw new Error("handler not registered");
  return capturedHandler({ data });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("onPhotoUploadFinalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownload.mockResolvedValue([Buffer.from("original-bytes")]);
  });

  it("derives 3 variants from a sample image", async () => {
    // None of the derived files exist yet.
    mockExists.mockResolvedValue([false]);

    await trigger({
      name: "uploads/uid/abc.jpg",
      bucket: "jacob-media-public-staging",
      contentType: "image/jpeg",
    });

    expect(generateVariantsMock).toHaveBeenCalledOnce();
    expect(mockSave).toHaveBeenCalledTimes(3);

    const savedPaths = mockSave.mock.calls.map((c: unknown[]) => c[0]);
    expect(savedPaths).toContain("derived/uid/abc_320.jpg");
    expect(savedPaths).toContain("derived/uid/abc_640.jpg");
    expect(savedPaths).toContain("derived/uid/abc_1280.jpg");
  });

  it("skips when all derived files already exist", async () => {
    mockExists.mockResolvedValue([true]);

    await trigger({
      name: "uploads/uid/abc.jpg",
      bucket: "jacob-media-public-staging",
      contentType: "image/jpeg",
    });

    expect(generateVariantsMock).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("skips objects outside uploads/ prefix", async () => {
    await trigger({
      name: "avatars/uid/photo.jpg",
      bucket: "jacob-media-public-staging",
      contentType: "image/jpeg",
    });

    expect(generateVariantsMock).not.toHaveBeenCalled();
  });

  it("skips non-image content types", async () => {
    await trigger({
      name: "uploads/uid/file.mp4",
      bucket: "jacob-media-public-staging",
      contentType: "video/mp4",
    });

    expect(generateVariantsMock).not.toHaveBeenCalled();
  });
});
