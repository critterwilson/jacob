import { expect, test } from "./helpers/fixtures";

test.describe("home", () => {
  test("daily verse, sidebar, your-groups all render", async ({
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

    // Daily verse: either the eyebrow ("Verse of the day") + Scripture
    // component renders, OR loading placeholders render briefly. We allow
    // either as long as the page didn't crash. The Scripture has the
    // distinctive `font-display` class.
    const verseSection = page.getByText(/verse of the day/i).first();
    const verseShown = await verseSection.isVisible().catch(() => false);
    if (!verseShown) {
      // Empty state messaging is acceptable too — the cron may not have
      // populated today's verse yet on staging.
      const noVerse = await page
        .getByText(/no verse|empty|check back/i)
        .first()
        .isVisible()
        .catch(() => false);
      expect(verseShown || noVerse).toBeTruthy();
    }

    // "Your groups" section.
    await expect(page.getByRole("heading", { name: /your groups/i })).toBeVisible();
  });
});
