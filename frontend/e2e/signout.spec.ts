import { signOut } from "./helpers/auth";
import { expect, test } from "./helpers/fixtures";

test.describe("sign out", () => {
  test("sidebar sign-out lands on /sign-in", async ({
    sharedAccountPage: page,
  }) => {
    await page.goto("/home", { waitUntil: "domcontentloaded" });
    await signOut(page);
    await expect(page).toHaveURL(/\/sign-in$/);

    // Trying to revisit a protected page should bounce back to /sign-in.
    await page.goto("/groups", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
  });
});
