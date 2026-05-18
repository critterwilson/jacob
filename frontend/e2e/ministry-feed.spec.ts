/**
 * ADR 0011 — happy-path smoke for the central ministry feed.
 *
 * The shared E2E user does NOT have the `ministry_owner` custom claim
 * granted in staging, so the spec only covers what a regular member
 * sees: the page loads under /feed, the header renders, and the
 * compose UI is HIDDEN. Posting itself is exercised by the backend
 * pytest suite (which mocks the claim) and by the function-trigger
 * vitest suite — the E2E surface here is the read view + RBAC gate.
 */

import { expect, test } from "./helpers/fixtures";

test.describe("ministry feed", () => {
  test("reader sees the feed header and no compose form", async ({
    sharedAccountPage: page,
  }) => {
    await page.goto("/feed", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { level: 1, name: /ministry feed/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/sermons, devotionals, and announcements/i),
    ).toBeVisible();
    // Compose form must NOT be visible to non-owners.
    await expect(
      page.getByRole("form", { name: /new ministry post/i }),
    ).toHaveCount(0);
  });
});
