import { expect, test } from "./helpers/fixtures";
import { uniqueLabel } from "./helpers/unique";

/**
 * Join-requests leader UI — happy-path e2e.
 *
 * Creates a fresh group (the creator is the leader/founder), navigates to
 * the join-requests page via the group hub nav, and verifies the empty
 * state is shown when there are no pending requests.
 *
 * Full approve/reject coverage requires a second account to submit a
 * request, so that flow is covered in the vitest unit suite. This spec
 * verifies routing, leader gating, and the empty state.
 */
test.describe("join requests — leader UI", () => {
  test("leader can reach join-requests page from group hub", async ({
    sharedAccountPage: page,
  }) => {
    test.slow();

    // Create a fresh group so we have a predictable state.
    await page.goto("/groups/new", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/group name/i).fill(`pw ${uniqueLabel("jr")}`);
    await page.getByRole("button", { name: /create group/i }).click();
    await expect(page).toHaveURL(/\/groups\/[A-Za-z0-9]+$/, { timeout: 20_000 });

    // The group hub should show a "Join requests" link for the leader.
    await expect(
      page.getByRole("link", { name: /join requests/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Navigate to the join-requests page.
    await page.getByRole("link", { name: /join requests/i }).click();
    await expect(page).toHaveURL(/\/join-requests$/, { timeout: 10_000 });

    // Empty state should be visible since the group was just created.
    await expect(
      page.getByTestId("empty-state"),
    ).toBeVisible({ timeout: 10_000 });
  });
});
