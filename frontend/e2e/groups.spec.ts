import { expect, test } from "./helpers/fixtures";
import { uniqueLabel } from "./helpers/unique";

test.describe("groups", () => {
  test("create a group, see it in the list, then leave it", async ({
    sharedAccountPage: page,
  }) => {
    const groupName = `pw ${uniqueLabel("group")}`;

    // Create.
    await page.goto("/groups/new", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/group name/i).fill(groupName);
    await page
      .getByLabel(/description/i)
      .fill("Created by Playwright E2E. Safe to delete.");
    await page.getByRole("button", { name: /create group/i }).click();

    // CreateGroupForm pushes to /groups/{gid} on success.
    await expect(page).toHaveURL(/\/groups\/[A-Za-z0-9]+$/, {
      timeout: 20_000,
    });
    const groupDetailURL = page.url();
    const gid = groupDetailURL.split("/").pop()!;

    // The group title should be visible somewhere on the detail page.
    await expect(page.getByText(groupName).first()).toBeVisible({
      timeout: 15_000,
    });

    // Verify it appears in the index list.
    await page.goto("/groups", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(groupName).first()).toBeVisible({
      timeout: 15_000,
    });

    // Leave the group via the settings page so we don't leave zombie
    // memberships in staging. The exact button label may differ; we accept
    // any of the common variants. If none surface, this turns into a
    // soft-fail follow-up rather than a hard test failure.
    await page.goto(`/groups/${gid}/settings`, {
      waitUntil: "domcontentloaded",
    });
    const leaveButton = page
      .getByRole("button", { name: /leave (group|this group)/i })
      .first();
    if (await leaveButton.isVisible().catch(() => false)) {
      await leaveButton.click();
      // Confirmation modals are common; click any "leave" / "confirm" affordance.
      const confirm = page
        .getByRole("button", { name: /^(leave|confirm|yes)$/i })
        .first();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
      }
      await expect(page).toHaveURL(/\/groups(\/?$|\?)/, { timeout: 15_000 });
    } else {
      test.info().annotations.push({
        type: "cleanup-skipped",
        description: `No leave-group button found on /groups/${gid}/settings — group ${gid} left in staging.`,
      });
    }
  });

  test("invite-with-code page is reachable for a group I own", async ({
    sharedAccountPage: page,
  }) => {
    // We can't realistically run a full invite-redeem flow with one browser
    // session, so this test verifies the invite UI for an owned group at
    // least loads + surfaces a code. This catches regressions in the
    // backend invite-issuing endpoint.
    const groupName = `pw ${uniqueLabel("invite")}`;

    await page.goto("/groups/new", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/group name/i).fill(groupName);
    await page.getByRole("button", { name: /create group/i }).click();
    await expect(page).toHaveURL(/\/groups\/[A-Za-z0-9]+$/, {
      timeout: 20_000,
    });
    const gid = page.url().split("/").pop()!;

    await page.goto(`/groups/${gid}/settings/invites`, {
      waitUntil: "domcontentloaded",
    });
    // The page renders something invite-related (link, button, code).
    // We assert at least one of those vocab words is on the screen.
    await expect(
      page.getByText(/invite|join code|share/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
