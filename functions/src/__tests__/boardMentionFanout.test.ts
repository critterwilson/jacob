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

function makeDb(opts: { blockedUids?: string[]; addMock?: Mock }): {
  db: Firestore;
  addMock: Mock;
} {
  const addMock = opts.addMock ?? vi.fn().mockResolvedValue({});
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
          })),
          add: addMock,
        })),
      })),
    })),
  } as unknown as Firestore;
  return { db, addMock };
}

describe("fanOutMentions on boards", () => {
  it("writes board_mention notifications, skips blocker", async () => {
    const { db, addMock } = makeDb({ blockedUids: ["bob"] });
    await fanOutMentions(db, {
      authorUid: "alice",
      mentions: ["bob", "carol"],
      payload: {
        kind: "board_mention",
        messageRef: "boards/b1/posts/p1",
        boardId: "b1",
      },
      isMember: async () => true,
    });
    expect(addMock).toHaveBeenCalledTimes(1);
    const [[firstArg]] = addMock.mock.calls as [
      [{ kind: string; boardId: string; messageRef: string; fromUid: string }],
    ];
    expect(firstArg.kind).toBe("board_mention");
    expect(firstArg.boardId).toBe("b1");
    expect(firstArg.messageRef).toBe("boards/b1/posts/p1");
    expect(firstArg.fromUid).toBe("alice");
  });

  it("skips self-mention", async () => {
    const { db, addMock } = makeDb({});
    await fanOutMentions(db, {
      authorUid: "alice",
      mentions: ["alice"],
      payload: {
        kind: "board_mention",
        messageRef: "boards/b1/posts/p1",
        boardId: "b1",
      },
      isMember: async () => true,
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("isMember=false suppresses fan-out (parity with group path)", async () => {
    const { db, addMock } = makeDb({});
    await fanOutMentions(db, {
      authorUid: "alice",
      mentions: ["bob"],
      payload: {
        kind: "mention",
        messageRef: "groups/g1/messages/m1",
        groupId: "g1",
      },
      isMember: async () => false,
    });
    expect(addMock).not.toHaveBeenCalled();
  });
});
