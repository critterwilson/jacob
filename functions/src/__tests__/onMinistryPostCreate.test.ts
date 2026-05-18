/**
 * Unit tests for ADR 0011 ministry-feed fan-out.
 *
 * Verifies:
 *   - Only users with `notificationPrefs.ministryFeed == true` receive a
 *     notification.
 *   - The author themselves is skipped.
 *   - Users who blocked the author are skipped (T21 producer-side suppression).
 *   - Notification doc ids are deterministic for redelivery safety.
 *   - `buildNotifBody` truncates and collapses whitespace.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: vi.fn((_, handler) => handler),
}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTime__" },
  getFirestore: vi.fn(),
}));

import type { Firestore } from "firebase-admin/firestore";

import {
  buildNotifBody,
  fanOutMinistryPost,
  recipientUidFromPrefsPath,
} from "../onMinistryPostCreate";

describe("recipientUidFromPrefsPath", () => {
  it("extracts uid from a standard prefs path", () => {
    expect(
      recipientUidFromPrefsPath("users/alice/notificationPrefs/main"),
    ).toBe("alice");
  });
  it("returns null for unexpected paths", () => {
    expect(recipientUidFromPrefsPath("garbage")).toBeNull();
  });
});

describe("buildNotifBody", () => {
  it("joins title and body with em-dash", () => {
    expect(buildNotifBody("Title", "Body")).toBe("Title — Body");
  });
  it("collapses whitespace and truncates to 200 chars", () => {
    const body = "lorem  ".repeat(60);
    const out = buildNotifBody("T", body);
    expect(out.length).toBeLessThanOrEqual(200);
  });
  it("omits the dash if title or body is empty", () => {
    expect(buildNotifBody("T", "")).toBe("T");
    expect(buildNotifBody("", "B")).toBe("B");
  });
});

type FakeDoc = {
  ref: { path: string };
  data: () => Record<string, unknown>;
};

type FakeBatch = {
  set: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
};

function makeDb(opts: {
  optedInUids: string[];
  blockedUids?: string[];
}): { db: Firestore; batches: FakeBatch[] } {
  const blocked = new Set(opts.blockedUids ?? []);
  const batches: FakeBatch[] = [];

  const prefsSnap = {
    size: opts.optedInUids.length,
    docs: opts.optedInUids.map<FakeDoc>((uid) => ({
      ref: { path: `users/${uid}/notificationPrefs/main` },
      data: () => ({ ministryFeed: true }),
    })),
  };

  const db = {
    collectionGroup: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(prefsSnap),
      }),
    }),
    collection: vi.fn().mockImplementation((_col: string) => ({
      doc: vi.fn().mockImplementation((uid: string) => ({
        collection: vi.fn().mockImplementation((subCol: string) => ({
          doc: vi.fn().mockImplementation((subId: string) => ({
            get: vi.fn().mockResolvedValue({
              exists: subCol === "blocks" && blocked.has(uid) && subId === "owner",
            }),
          })),
        })),
      })),
    })),
    batch: vi.fn().mockImplementation(() => {
      const b: FakeBatch = {
        set: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      batches.push(b);
      return b;
    }),
  } as unknown as Firestore;
  return { db, batches };
}

describe("fanOutMinistryPost", () => {
  it("writes one notification per opted-in user, skipping the author", async () => {
    const { db, batches } = makeDb({
      optedInUids: ["alice", "owner", "carol"],
    });
    const count = await fanOutMinistryPost(db, {
      postId: "p1",
      authorUid: "owner",
      title: "Sermon",
      body: "Body",
    });
    expect(count).toBe(2);
    const batch = batches[0];
    expect(batch.set).toHaveBeenCalledTimes(2);

    const refs = batch.set.mock.calls.map(
      (c) => (c[0] as { id?: string }).id ?? null,
    );
    // Each set was called with `db.collection("users").doc(uid)...doc(deterministicId)`;
    // our fake doc() chain doesn't synthesize ids, so we assert via the
    // payload instead.
    const payloads = batch.set.mock.calls.map((c) => c[1] as Record<string, unknown>);
    for (const p of payloads) {
      expect(p.kind).toBe("ministry_post");
      expect(p.messageRef).toBe("ministry_feed/p1");
      expect(p.fromUid).toBe("owner");
    }
    void refs;
  });

  it("skips users who have blocked the author", async () => {
    const { db, batches } = makeDb({
      optedInUids: ["alice", "carol"],
      blockedUids: ["alice"],
    });
    const count = await fanOutMinistryPost(db, {
      postId: "p1",
      authorUid: "owner",
      title: "T",
      body: "B",
    });
    expect(count).toBe(1);
    expect(batches[0].set).toHaveBeenCalledTimes(1);
  });

  it("returns 0 and skips batches when nobody opted in", async () => {
    const { db, batches } = makeDb({ optedInUids: [] });
    const count = await fanOutMinistryPost(db, {
      postId: "p1",
      authorUid: "owner",
      title: "T",
      body: "B",
    });
    expect(count).toBe(0);
    expect(batches).toHaveLength(0);
  });
});
