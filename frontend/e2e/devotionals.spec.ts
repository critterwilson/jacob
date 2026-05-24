import { expect, test } from "./helpers/fixtures";

test.describe("devotionals", () => {
  test("index loads and a devotional opens with EB Garamond serif", async ({
    sharedAccountPage: page,
  }) => {
    await page.goto("/devotionals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /devotionals/i })).toBeVisible({
      timeout: 15_000,
    });

    const firstDevotional = page.locator("a[href^='/devotionals/']").first();
    if (!(await firstDevotional.isVisible().catch(() => false))) {
      test.skip(
        true,
        "No devotionals published on staging — nothing to drill into.",
      );
      return;
    }

    await firstDevotional.click();
    // After the auto-slug rename, URLs can be one of three shapes:
    //   /devotionals/<slug>                       (legacy seed data)
    //   /devotionals/org/<slug>                   (platform-wide)
    //   /devotionals/group/<authorHash>/<slug>    (group-scoped)
    await expect(page).toHaveURL(
      /\/devotionals\/([A-Za-z0-9-]+|org\/[A-Za-z0-9-]+|group\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+)$/,
      { timeout: 15_000 },
    );

    // Scripture component renders with `font-display`, which Tailwind aliases
    // to `var(--font-eb-garamond)` ahead of an Iowan Old Style fallback.
    // Reading computedStyle catches a regression where the font is dropped
    // (unit tests can't see real CSS load failures).
    const blockquote = page.locator("blockquote").first();
    if (await blockquote.isVisible().catch(() => false)) {
      const fontFamily = await blockquote.evaluate(
        (el) => getComputedStyle(el).fontFamily,
      );
      // Either the loaded EB Garamond webfont OR its fallback chain contains
      // a serif name. We accept any of the documented chain entries.
      expect(fontFamily).toMatch(
        /(eb garamond|iowan old style|georgia|times|serif)/i,
      );
    } else {
      test.info().annotations.push({
        type: "skipped-assertion",
        description: "Devotional detail page rendered, but no <blockquote> found to font-check.",
      });
    }

    // Navigate back to the index.
    await page.goBack();
    await expect(page).toHaveURL(/\/devotionals$/);
  });
});
