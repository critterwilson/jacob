/**
 * Unit tests for the per-device FCM dispatch worker (H2).
 *
 * `processSendFcmTask` is the pure handler under the `onTaskDispatched`
 * trigger. We exercise the three outcomes (delivered, stale token,
 * other failure) and assert the on-disk side-effects: the notif doc
 * counter increments, and stale tokens delete their device doc.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

vi.mock("firebase-functions/v2/tasks", () => ({
  onTaskDispatched: vi.fn((_, handler) => handler),
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const incrementMock = vi.fn((n: number) => ({ __increment: n }));
const serverTimestampMock = vi.fn(() => "__serverTime__");

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (n: number) => incrementMock(n),
    serverTimestamp: () => serverTimestampMock(),
  },
  getFirestore: vi.fn(),
}));

vi.mock("../services/fcm", () => ({
  sendFcm: vi.fn(),
  StaleTokenError: class extends Error {
    constructor(token: string) {
      super(`stale: ${token}`);
      this.name = "StaleTokenError";
    }
  },
}));

import { processSendFcmTask, type SendFcmTaskPayload } from "../sendFcmTask";
import { StaleTokenError } from "../services/fcm";

type MockDocRef = {
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  path: string;
};

function makeDb(): {
  db: {
    doc: ReturnType<typeof vi.fn>;
    _docs: Record<string, MockDocRef>;
  };
} {
  const docs: Record<string, MockDocRef> = {};
  const db = {
    _docs: docs,
    doc: vi.fn((path: string) => {
      if (!docs[path]) {
        docs[path] = {
          path,
          set: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
        };
      }
      return docs[path];
    }),
  };
  return { db };
}

const basePayload: SendFcmTaskPayload = {
  uid: "alice",
  deviceId: "dev-1",
  fcmToken: "token-abc",
  notifPath: "users/alice/notifications/n1",
  fcmPayload: {
    title: "test",
    body: "hello",
    collapseKey: "t:1",
  },
};

describe("processSendFcmTask", () => {
  it("delivered: increments delivered counter + stamps deliveredAt", async () => {
    const { db } = makeDb();
    const sendFcmFn = vi.fn().mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await processSendFcmTask(basePayload, { db: db as any, sendFcmFn });

    expect(result).toEqual({ status: "delivered" });
    expect(sendFcmFn).toHaveBeenCalledTimes(1);
    expect(sendFcmFn).toHaveBeenCalledWith("token-abc", basePayload.fcmPayload);
    const notifRef = db._docs["users/alice/notifications/n1"];
    expect(notifRef.set).toHaveBeenCalledTimes(1);
    expect(notifRef.set).toHaveBeenCalledWith(
      {
        delivered: { __increment: 1 },
        deliveredAt: "__serverTime__",
      },
      { merge: true },
    );
  });

  it("stale token: deletes device doc + increments failed counter", async () => {
    const { db } = makeDb();
    const sendFcmFn = vi
      .fn()
      .mockRejectedValue(new StaleTokenError("token-abc"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await processSendFcmTask(basePayload, { db: db as any, sendFcmFn });

    expect(result).toEqual({ status: "stale_token" });
    expect(db._docs["users/alice/devices/dev-1"].delete).toHaveBeenCalledTimes(1);
    expect(db._docs["users/alice/notifications/n1"].set).toHaveBeenCalledTimes(1);
    expect(db._docs["users/alice/notifications/n1"].set).toHaveBeenCalledWith(
      { failed: { __increment: 1 } },
      { merge: true },
    );
  });

  it("other failure: increments failed counter + records reason + re-throws (H2)", async () => {
    const { db } = makeDb();
    const sendFcmFn = vi.fn().mockRejectedValue(new Error("network down"));

    // H2 regression: a transient FCM error MUST propagate out of the handler so
    // the Cloud Tasks wrapper sees a failure and applies its retryConfig.
    // Previously the handler caught + returned `{status: "failed"}`, which the
    // wrapper awaited without re-throwing — Cloud Tasks then marked the task
    // delivered and `maxAttempts: 3` was dead code.
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processSendFcmTask(basePayload, { db: db as any, sendFcmFn }),
    ).rejects.toThrow("network down");

    const notifRef = db._docs["users/alice/notifications/n1"];
    expect(notifRef.set).toHaveBeenCalledTimes(1);
    expect(notifRef.set).toHaveBeenCalledWith(
      {
        failed: { __increment: 1 },
        failureReason: "network down",
        failedAt: "__serverTime__",
      },
      { merge: true },
    );
    // Stale-token branch was NOT taken: device doc was not touched.
    expect(db._docs["users/alice/devices/dev-1"]).toBeUndefined();
  });

  it("stale token: does NOT re-throw — terminal, not retryable (H2)", async () => {
    // Counterpart to the H2 regression above: stale tokens are a normal
    // terminal outcome (device doc cleaned up + failed counter bumped) and
    // must NOT trigger a Cloud Tasks retry. Verifies the throw added for
    // transient errors did not regress this branch.
    const { db } = makeDb();
    const sendFcmFn = vi
      .fn()
      .mockRejectedValue(new StaleTokenError("token-abc"));

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processSendFcmTask(basePayload, { db: db as any, sendFcmFn }),
    ).resolves.toEqual({ status: "stale_token" });
  });
});
