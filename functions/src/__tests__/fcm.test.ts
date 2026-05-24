/**
 * Wire-shape tests for the FCM send helper.
 *
 * Pins the structure of the payload handed to firebase-admin's
 * `messaging.send()`. The tests that motivated this file:
 *
 *  - `webpush.notification.tag` must match the FCM `collapseKey`. The
 *    `headers.Topic` collapses on Apple's web-push gateway; `tag` is
 *    what the *browser* uses to collapse already-displayed
 *    notifications. Without it, rapid sends to the same group
 *    stacked individual banners on the lock screen.
 *
 *  - The top-level `notification` field is set. The FCM SDK on the
 *    SW auto-displays notification-type payloads — that is the
 *    single intentional display path. If a future change makes the
 *    payload data-only, the SW would need an explicit
 *    `onBackgroundMessage` handler to render anything.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const sendSpy = vi.fn(async () => "ok");

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({ send: sendSpy }),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTime__" },
  getFirestore: vi.fn(),
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { sendFcm, type FcmPayload } from "../services/fcm";

beforeEach(() => {
  sendSpy.mockClear();
  delete process.env.FCM_DISABLED;
});

describe("sendFcm payload shape", () => {
  it("sets webpush.notification.tag to the collapseKey so the browser also collapses", async () => {
    const payload: FcmPayload = {
      title: "💬 New message",
      body: "hello",
      collapseKey: "group_message:g1",
    };
    await sendFcm("fake-token", payload);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.webpush).toMatchObject({
      headers: { Topic: "group_message:g1" },
      notification: expect.objectContaining({
        tag: "group_message:g1",
      }),
    });
  });

  it("keeps a top-level notification field so the FCM SDK auto-displays", async () => {
    // The SW deliberately omits a manual showNotification call in
    // onBackgroundMessage — that path used to render a duplicate. The
    // SDK's auto-display only fires when `notification` is set, so
    // dropping this field would silently break ALL push delivery to
    // the device. Pin it.
    const payload: FcmPayload = {
      title: "📢 Announcement",
      body: "x",
      collapseKey: "announcement:g1",
    };
    await sendFcm("fake-token", payload);
    const sent = sendSpy.mock.calls[0][0] as {
      notification?: { title?: string; body?: string };
    };
    expect(sent.notification).toEqual({ title: "📢 Announcement", body: "x" });
  });
});
