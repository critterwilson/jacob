import { expect, test } from "./helpers/fixtures";

test.describe("home", () => {
  test("sidebar and your-groups render", async ({
    sharedAccountPage: page,
  }) => {
    await page.goto("/home", { waitUntil: "domcontentloaded" });

    // Welcome heading is visible. We don't assert on the display name to
    // keep the test resilient to profile changes on the shared account.
    await expect(page.getByRole("heading", { name: /^welcome/i })).toBeVisible();

    // Sidebar nav (desktop viewport — devices['Desktop Chrome'] is 1280×720).
    const nav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(nav.getByRole("link", { name: /chats/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /boards/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^about$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^faq$/i })).toBeVisible();

    // "Your groups" section.
    await expect(page.getByRole("heading", { name: /your groups/i })).toBeVisible();
  });
});
