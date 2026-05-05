import { expect, test } from "./helpers/fixtures";

test.describe("settings", () => {
  test("notification preference toggles persist across reloads", async ({
    sharedAccountPage: page,
  }) => {
    await page.goto("/settings/notifications", {
      waitUntil: "domcontentloaded",
    });

    const mentionsToggle = page.getByRole("switch", { name: /mentions/i });
    await expect(mentionsToggle).toBeVisible({ timeout: 15_000 });

    const beforeChecked = await mentionsToggle.getAttribute("aria-checked");
    await mentionsToggle.click();
    await expect(mentionsToggle).toHaveAttribute(
      "aria-checked",
      beforeChecked === "true" ? "false" : "true",
      { timeout: 10_000 },
    );

    // Reload and assert the new state still wins.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(mentionsToggle).toHaveAttribute(
      "aria-checked",
      beforeChecked === "true" ? "false" : "true",
      { timeout: 15_000 },
    );

    // Restore the original value so subsequent runs start from a stable
    // baseline.
    await mentionsToggle.click();
    await expect(mentionsToggle).toHaveAttribute(
      "aria-checked",
      beforeChecked ?? "true",
      { timeout: 10_000 },
    );
  });

  test("blocked-users page loads", async ({ sharedAccountPage: page }) => {
    await page.goto("/settings/blocked", { waitUntil: "domcontentloaded" });
    // The page should render either the list of blocked users or an empty
    // state. Asserting the heading is enough to catch a routing/auth regression.
    const heading = page
      .getByRole("heading", { name: /blocked|block list/i })
      .first();
    if (!(await heading.isVisible().catch(() => false))) {
      // Fall back to any "blocked" copy on the page.
      await expect(page.getByText(/blocked/i).first()).toBeVisible({
        timeout: 10_000,
      });
    }
  });
});
