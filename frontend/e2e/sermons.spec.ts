import { expect, test } from "./helpers/fixtures";
import { uniqueLabel } from "./helpers/unique";

/**
 * Sermons live under /groups/{gid}/sermons (per-group library), not at a
 * top-level route. We create a fresh group for the test so we don't lean on
 * any prior state on the shared account.
 */
test.describe("sermons", () => {
  test("group sermons page loads", async ({ sharedAccountPage: page }) => {
    await page.goto("/groups/new", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/group name/i).fill(`pw ${uniqueLabel("sermons")}`);
    await page.getByRole("button", { name: /create group/i }).click();
    await expect(page).toHaveURL(/\/groups\/[A-Za-z0-9]+$/, { timeout: 20_000 });
    const gid = page.url().split("/").pop()!;

    await page.goto(`/groups/${gid}/sermons`, {
      waitUntil: "domcontentloaded",
    });

    // The page renders something sermons-related — heading or empty state.
    const sermonsCue = page
      .getByText(/sermon/i)
      .first();
    await expect(sermonsCue).toBeVisible({ timeout: 15_000 });
  });
});
