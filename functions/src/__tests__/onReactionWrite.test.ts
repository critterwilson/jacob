import { describe, expect, it, vi, type Mock } from "vitest";
import { reactionDelta, runReactionTxn } from "../onReactionWrite";
import type { Transaction, DocumentReference } from "firebase-admin/firestore";

// ── reactionDelta (pure) ──────────────────────────────────────────────────────

describe("reactionDelta", () => {
  it("delta_is_+1_on_create", () => {
    expect(reactionDelta(false, true)).toBe(1);
  });

  it("delta_is_-1_on_delete", () => {
    expect(reactionDelta(true, false)).toBe(-1);
  });

  it("delta_is_0_on_update (both exist)", () => {
    expect(reactionDelta(true, true)).toBe(0);
  });

  it("delta_is_0_on_no_change (neither exist)", () => {
    expect(reactionDelta(false, false)).toBe(0);
  });
});

// ── runReactionTxn (transaction logic) ────────────────────────────────────────

function makeTxn(eventExists: boolean): {
  txn: Transaction;
  setMock: Mock;
} {
  const setMock = vi.fn();
  const txn = {
    get: vi.fn().mockResolvedValue({ exists: eventExists }),
    set: setMock,
  } as unknown as Transaction;
  return { txn, setMock };
}

function makeMsgRef(): DocumentReference {
  const eventDocMock = {};
  const eventColMock = {
    doc: vi.fn().mockReturnValue(eventDocMock),
  };
  return {
    collection: vi.fn().mockReturnValue(eventColMock),
  } as unknown as DocumentReference;
}

describe("runReactionTxn", () => {
  it("applies the increment when event is new", async () => {
    const { txn, setMock } = makeTxn(false);
    const msgRef = makeMsgRef();
    const applied = await runReactionTxn(txn, msgRef, "pray", 1, "evt-1");
    expect(applied).toBe(true);
    expect(setMock).toHaveBeenCalledTimes(2);
  });

  it("idempotent_under_double_delivery — second call with same eventId is a no-op", async () => {
    const { txn, setMock } = makeTxn(true);
    const msgRef = makeMsgRef();
    const applied = await runReactionTxn(txn, msgRef, "pray", 1, "evt-1");
    expect(applied).toBe(false);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("failed_transaction_throws_for_observability", async () => {
    const txn = {
      get: vi.fn().mockRejectedValue(new Error("Firestore unavailable")),
      set: vi.fn(),
    } as unknown as Transaction;
    const msgRef = makeMsgRef();
    await expect(runReactionTxn(txn, msgRef, "pray", 1, "evt-err")).rejects.toThrow(
      "Firestore unavailable",
    );
  });
});
