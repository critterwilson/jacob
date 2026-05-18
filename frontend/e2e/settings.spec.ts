import { expect, test } from "./helpers/fixtures";

test.describe("settings", () => {
  test("settings index links to profile page", async ({
    sharedAccountPage: page,
  }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("link", { name: /edit profile/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("profile edit — change display name → save → success banner", async ({
    sharedAccountPage: page,
  }) => {
    await page.goto("/settings/profile", { waitUntil: "domcontentloaded" });

    const nameInput = page.getByRole("textbox", { name: /display name/i });
    await expect(nameInput).toBeVisible({ timeout: 15_000 });

    const originalName = (await nameInput.inputValue()) || "Test User";
    const newName = `${originalName} ✏`;

    await nameInput.fill(newName);
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/profile updated/i)).toBeVisible({
      timeout: 10_000,
    });

    // Restore original display name so subsequent runs start from stable state.
    await nameInput.fill(originalName);
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/profile updated/i)).toBeVisible({
      timeout: 10_000,
    });
  });


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
