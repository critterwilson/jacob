import { expect, test } from "./helpers/fixtures";

test.describe("home", () => {
  test("weekly sermon hero, recent activity, and sidebar render", async ({
    sharedAccountPage: page,
  }) => {
    await page.goto("/home", { waitUntil: "domcontentloaded" });

    // Surface 1 — the weekly sermon hero. The "This week's sermon" eyebrow
    // renders whether or not a sermon has been published, so it's a stable
    // assertion on the shared account.
    await expect(page.getByText(/this week's sermon/i).first()).toBeVisible();

    // Surface 2 — recent chat activity.
    await expect(
      page.getByRole("heading", { name: /recent in your groups/i }),
    ).toBeVisible();

    // Sidebar nav (desktop viewport — devices['Desktop Chrome'] is 1280×720).
    const nav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(nav.getByRole("link", { name: /^groups$/i }).first()).toBeVisible();
    await expect(nav.getByRole("link", { name: /boards/i }).first()).toBeVisible();
    await expect(nav.getByRole("link", { name: /^about$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^faq$/i })).toBeVisible();
  });
});
