import { describe, expect, it, vi, type Mock } from "vitest";
import { fanOutMentionNotifications } from "../onMessageCreate";
import type { Firestore } from "firebase-admin/firestore";

// ── helpers ───────────────────────────────────────────────────────────────────

type DocData = { exists: boolean; data?: () => Record<string, unknown> };

function makeDb(overrides: {
  blockedUids?: string[];   // uids that have blocked authorUid
  nonMemberUids?: string[]; // uids NOT in the group
  addMock?: Mock;
}): { db: Firestore; addMock: Mock } {
  const addMock = overrides.addMock ?? vi.fn().mockResolvedValue({});

  const db = {
    collection: vi.fn().mockImplementation((col: string) => ({
      doc: vi.fn().mockImplementation((docId: string) => ({
        collection: vi.fn().mockImplementation((subCol: string) => ({
          doc: vi.fn().mockImplementation((subDocId: string) => ({
            get: vi.fn().mockResolvedValue({
              exists: buildExists(col, docId, subCol, subDocId, overrides),
            } as DocData),
          })),
          add: addMock,
        })),
      })),
    })),
  } as unknown as Firestore;

  return { db, addMock };
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
    const { db, addMock } = makeDb({});
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["bob", "carol"]);
    expect(addMock).toHaveBeenCalledTimes(2);
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "mention",
        groupId: "g1",
        fromUid: "alice",
        readAt: null,
      }),
    );
  });

  it("skips self-mention — no notification written", async () => {
    const { db, addMock } = makeDb({});
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["alice"]);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("skips recipient who has blocked the author", async () => {
    const { db, addMock } = makeDb({ blockedUids: ["bob"] });
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["bob", "carol"]);
    // bob blocked alice, carol did not
    expect(addMock).toHaveBeenCalledTimes(1);
    const [[firstArg]] = addMock.mock.calls as [[{ fromUid: string }]];
    expect(firstArg.fromUid).toBe("alice");
  });

  it("skips non-member uids", async () => {
    const { db, addMock } = makeDb({ nonMemberUids: ["outsider"] });
    await fanOutMentionNotifications(db, "g1", "m1", "alice", ["outsider", "bob"]);
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("empty mentions array is a no-op", async () => {
    const { db, addMock } = makeDb({});
    await fanOutMentionNotifications(db, "g1", "m1", "alice", []);
    expect(addMock).not.toHaveBeenCalled();
  });
});
