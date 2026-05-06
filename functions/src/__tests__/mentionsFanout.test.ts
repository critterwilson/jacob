import { describe, expect, it, vi, type Mock } from "vitest";
import { fanOutMentionNotifications } from "../onMessageCreate";
import type { Firestore } from "firebase-admin/firestore";

// ── helpers ───────────────────────────────────────────────────────────────────

type DocData = { exists: boolean; data?: () => Record<string, unknown> };

type FanoutCall = { recipientUid: string; notifId: string; data: Record<string, unknown> };

function makeDb(overrides: {
  blockedUids?: string[];   // uids that have blocked authorUid
  nonMemberUids?: string[]; // uids NOT in the group
}): { db: Firestore; setMock: Mock; calls: FanoutCall[] } {
  const calls: FanoutCall[] = [];
  // Track set() invocations along with the recipient and notif doc id so the
  // tests can assert deterministic ids on redelivery.
  const setMock = vi.fn().mockImplementation(async () => undefined);

  const db = {
    collection: vi.fn().mockImplementation((col: string) => ({
      doc: vi.fn().mockImplementation((docId: string) => ({
        collection: vi.fn().mockImplementation((subCol: string) => ({
          doc: vi.fn().mockImplementation((subDocId: string) => ({
            get: vi.fn().mockResolvedValue({
              exists: buildExists(col, docId, subCol, subDocId, overrides),
            } as DocData),
            set: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
              if (col === "users" && subCol === "notifications") {
                calls.push({ recipientUid: docId, notifId: subDocId, data });
                setMock(data);
              }
            }),
          })),
        })),
      })),
    })),
  } as unknown as Firestore;

  return { db, setMock, calls };
}

function buildExists(
  col: string,
  docId: string,
  subCol: string,
  subDocId: string,
  overrides: { blockedUids?: string[]; nonMemberUids?: string[] },
): boolean {
  if (col === "users" && subCol === "blocks") {
    return (overrides.blockedUids ?? []).includes(docId);
  }
  if (col === "groups" && subCol === "members") {
    return !(overrides.nonMemberUids ?? []).includes(subDocId);
  }
  return false;
}

// ── fanOutMentionNotifications ────────────────────────────────────────────────

describe("fanOutMentionNotifications", () => {
  it("writes one notification per mentioned member", async () => {
    const { db, setMock, calls } = makeDb({});
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["bob", "carol"], "evt1");
    expect(setMock).toHaveBeenCalledTimes(2);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "mention",
        groupId: "g1",
        fromUid: "alice",
        readAt: null,
      }),
    );
    expect(calls.map((c) => c.notifId).sort()).toEqual(
      ["mention_evt1_bob", "mention_evt1_carol"].sort(),
    );
  });

  it("skips self-mention — no notification written", async () => {
    const { db, setMock } = makeDb({});
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["alice"], "evt1");
    expect(setMock).not.toHaveBeenCalled();
  });

  it("skips recipient who has blocked the author", async () => {
    const { db, setMock, calls } = makeDb({ blockedUids: ["bob"] });
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["bob", "carol"], "evt1");
    // bob blocked alice, carol did not
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(calls[0].recipientUid).toBe("carol");
    expect(calls[0].data.fromUid).toBe("alice");
  });

  it("skips non-member uids", async () => {
    const { db, setMock } = makeDb({ nonMemberUids: ["outsider"] });
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["outsider", "bob"], "evt1");
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it("empty mentions array is a no-op", async () => {
    const { db, setMock } = makeDb({});
    await fanOutMentionNotifications(db, "g1", "m1", "alice", [], "evt1");
    expect(setMock).not.toHaveBeenCalled();
  });

  // H-FUNC-3 regression: at-least-once redelivery of the same trigger event
  // must collapse to a single notification doc per recipient. Deterministic
  // doc ids `mention_${eventId}_${uid}` make .set() idempotent so redelivery
  // overwrites instead of duplicating.
  it("at-least-once redelivery with the same eventId writes one notification per recipient", async () => {
    const { db, setMock, calls } = makeDb({});
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["bob", "carol"], "evt-redeliver");
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["bob", "carol"], "evt-redeliver");

    // 4 set() calls in total (2 recipients * 2 deliveries) but they must hit
    // 2 unique deterministic doc ids — so production Firestore collapses to
    // one notification per recipient. The test asserts the doc ids are
    // identical across redeliveries.
    expect(setMock).toHaveBeenCalledTimes(4);
    const uniqueDocIds = new Set(calls.map((c) => `${c.recipientUid}/${c.notifId}`));
    expect(uniqueDocIds.size).toBe(2);
    expect([...uniqueDocIds].sort()).toEqual(
      ["bob/mention_evt-redeliver_bob", "carol/mention_evt-redeliver_carol"].sort(),
    );
  });
});
