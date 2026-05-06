/**
 * T32 — fanOutMentions on the boards path.
 *
 * Boards have no membership; isMember resolves to true so block-only
 * suppression is the gating logic. Notification kind must be
 * "board_mention".
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import { fanOutMentions } from "../services/mentionFanout";
import type { Firestore } from "firebase-admin/firestore";

type DocData = { exists: boolean };

type FanoutCall = { recipientUid: string; notifId: string; data: Record<string, unknown> };

function makeDb(opts: { blockedUids?: string[] }): {
  db: Firestore;
  setMock: Mock;
  calls: FanoutCall[];
} {
  const calls: FanoutCall[] = [];
  const setMock = vi.fn().mockImplementation(async () => undefined);
  const db = {
    collection: vi.fn().mockImplementation((col: string) => ({
      doc: vi.fn().mockImplementation((docId: string) => ({
        collection: vi.fn().mockImplementation((subCol: string) => ({
          doc: vi.fn().mockImplementation((subDocId: string) => ({
            get: vi.fn().mockResolvedValue({
              exists:
                col === "users" &&
                subCol === "blocks" &&
                (opts.blockedUids ?? []).includes(docId) &&
                subDocId === "alice",
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

describe("fanOutMentions on boards", () => {
  it("writes board_mention notifications, skips blocker", async () => {
    const { db, setMock, calls } = makeDb({ blockedUids: ["bob"] });
    await fanOutMentions(db, {
      authorUid: "alice",
      mentions: ["bob", "carol"],
      payload: {
        kind: "board_mention",
        messageRef: "boards/b1/posts/p1",
        boardId: "b1",
      },
      isMember: async () => true,
      eventId: "evt1",
    });
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(calls[0].recipientUid).toBe("carol");
    expect(calls[0].notifId).toBe("mention_evt1_carol");
    expect(calls[0].data.kind).toBe("board_mention");
    expect(calls[0].data.boardId).toBe("b1");
    expect(calls[0].data.messageRef).toBe("boards/b1/posts/p1");
    expect(calls[0].data.fromUid).toBe("alice");
  });

  it("skips self-mention", async () => {
    const { db, setMock } = makeDb({});
    await fanOutMentions(db, {
      authorUid: "alice",
      mentions: ["alice"],
      payload: {
        kind: "board_mention",
        messageRef: "boards/b1/posts/p1",
        boardId: "b1",
      },
      isMember: async () => true,
      eventId: "evt1",
    });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("isMember=false suppresses fan-out (parity with group path)", async () => {
    const { db, setMock } = makeDb({});
    await fanOutMentions(db, {
      authorUid: "alice",
      mentions: ["bob"],
      payload: {
        kind: "mention",
        messageRef: "groups/g1/messages/m1",
        groupId: "g1",
      },
      isMember: async () => false,
      eventId: "evt1",
    });
    expect(setMock).not.toHaveBeenCalled();
  });
});
