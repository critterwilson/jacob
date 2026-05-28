import { expect, test } from "./helpers/fixtures";

/**
 * Regression guard for #354 (always-visible bottom nav).
 *
 * The mobile bottom tab bar is `position: fixed` at the viewport bottom.
 * The bug this guards against: an ancestor gaining a `transform` /
 * `filter` / `contain` (which would make it the containing block for the
 * fixed bar, so the bar scrolls with content instead of staying pinned),
 * or the bar reverting to an in-flow element.
 *
 * We force the page taller than the viewport, scroll to the bottom, and
 * assert the bar's bottom edge still sits on the viewport's bottom edge —
 * i.e. it did not scroll away. Runs on a phone-sized viewport because the
 * tab bar is `md:hidden` (desktop uses the persistent left rail).
 */

// Phone viewport so the md:hidden tab bar is rendered.
test.use({ viewport: { width: 390, height: 720 } });

test.describe("bottom nav stays pinned", () => {
  test("tab bar bottom == viewport bottom after scrolling a tall page", async ({
    sharedAccountPage: page,
  }) => {
    await page.goto("/home", { waitUntil: "domcontentloaded" });

    const nav = page.getByRole("navigation", { name: /primary navigation/i });
    await expect(nav).toBeVisible();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size");

    // Pinned-to-viewport-bottom check. env(safe-area-inset-bottom) is 0 in
    // headless Chromium, so the bar's bottom edge should equal the viewport
    // height (allow 1px for sub-pixel rounding).
    const bottomEdge = async (): Promise<number> => {
      const box = await nav.boundingBox();
      if (!box) throw new Error("nav has no bounding box");
      return box.y + box.height;
    };

    const beforeScroll = await bottomEdge();
    expect(Math.abs(beforeScroll - viewport.height)).toBeLessThanOrEqual(1);

    // Guarantee something to scroll: append a tall spacer into <main>
    // (the page's scroll content) regardless of how much real content the
    // shared account has on /home.
    await page.evaluate(() => {
      const main = document.querySelector("main");
      const spacer = document.createElement("div");
      spacer.style.height = "3000px";
      spacer.setAttribute("data-test-spacer", "");
      (main ?? document.body).appendChild(spacer);
    });

    // Scroll both the window and <main> to the bottom — whichever is the
    // real scroll container, the fixed bar must not move.
    await page.evaluate(() => {
      const main = document.querySelector("main");
      if (main) main.scrollTop = main.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    });
    // Let the scroll settle.
    await page.waitForTimeout(200);

    const afterScroll = await bottomEdge();
    // Still pinned to the viewport bottom, and unmoved by the scroll.
    expect(Math.abs(afterScroll - viewport.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterScroll - beforeScroll)).toBeLessThanOrEqual(1);

    // The tabs are still tappable (not scrolled off-screen).
    await expect(nav.getByRole("link", { name: /^home$/i })).toBeVisible();
  });
});
