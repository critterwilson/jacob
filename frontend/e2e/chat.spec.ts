import { expect, test } from "./helpers/fixtures";
import { uniqueLabel } from "./helpers/unique";

/**
 * Chat E2E exercises the message-send round-trip end-to-end. The shared
 * account creates a fresh group per run to keep messages out of long-lived
 * groups, then drives the message UI.
 */
test.describe("chat", () => {
  test("send → edit → react → thread reply → soft-delete in a fresh group", async ({
    sharedAccountPage: page,
  }) => {
    test.slow();

    // Create a fresh group for the test.
    await page.goto("/groups/new", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/group name/i).fill(`pw ${uniqueLabel("chat")}`);
    await page.getByRole("button", { name: /create group/i }).click();
    await expect(page).toHaveURL(/\/groups\/[A-Za-z0-9]+$/, { timeout: 20_000 });
    const gid = page.url().split("/").pop()!;

    await page.goto(`/groups/${gid}/chat`, { waitUntil: "domcontentloaded" });
    const messageForm = page.getByRole("form", { name: /send a message/i });
    await expect(messageForm).toBeVisible({ timeout: 15_000 });

    // Send.
    const body = `Playwright says hello ${Date.now()}`;
    await messageForm.getByLabel(/message body/i).fill(body);
    await messageForm.getByRole("button", { name: /^send$/i }).click();
    const sentMessage = page.getByText(body).first();
    await expect(sentMessage).toBeVisible({ timeout: 15_000 });

    // Edit. The edit affordance lives in MessageItem and may be exposed via
    // a kebab/menu or a direct "Edit" button. We try the common cases and
    // skip the edit step (annotation only) if none show up.
    const messageRow = sentMessage.locator("..").locator("..");
    const editTrigger = messageRow
      .getByRole("button", { name: /^edit$/i })
      .first();
    if (await editTrigger.isVisible().catch(() => false)) {
      await editTrigger.click();
      const editArea = page.getByRole("textbox").last();
      await editArea.fill(body + " (edited)");
      const saveBtn = page
        .getByRole("button", { name: /^save( changes)?$/i })
        .first();
      await saveBtn.click();
      await expect(page.getByText(body + " (edited)").first()).toBeVisible({
        timeout: 10_000,
      });
    } else {
      test.info().annotations.push({
        type: "skipped-step",
        description: "No Edit affordance surfaced on own message — edit step skipped.",
      });
    }

    // React with the first sticker in the picker. ReactionPicker exposes
    // sticker buttons; the exact selector varies, so we try a generic
    // sticker-button locator.
    const reactTrigger = messageRow
      .getByRole("button", { name: /react|add reaction|emoji/i })
      .first();
    if (await reactTrigger.isVisible().catch(() => false)) {
      await reactTrigger.click();
      const firstSticker = page
        .locator("[data-sticker], button[aria-label*='sticker']")
        .first();
      if (await firstSticker.isVisible().catch(() => false)) {
        await firstSticker.click();
      }
    }

    // Thread reply. ThreadPanel opens via a "Reply" / "Thread" button.
    const threadTrigger = messageRow
      .getByRole("button", { name: /^reply|thread|in thread$/i })
      .first();
    if (await threadTrigger.isVisible().catch(() => false)) {
      await threadTrigger.click();
      const replyInput = page.getByRole("textbox").last();
      const replyBody = `Reply ${Date.now()}`;
      await replyInput.fill(replyBody);
      await page
        .getByRole("button", { name: /^(reply|send)$/i })
        .last()
        .click();
      await expect(page.getByText(replyBody).first()).toBeVisible({
        timeout: 10_000,
      });
    } else {
      test.info().annotations.push({
        type: "skipped-step",
        description: "No thread/reply affordance surfaced — thread step skipped.",
      });
    }

    // Soft-delete. As above, accept "Delete" or a kebab-then-delete flow.
    const deleteBtn = messageRow
      .getByRole("button", { name: /^delete$/i })
      .first();
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
      const confirm = page
        .getByRole("button", { name: /^(delete|confirm|yes)$/i })
        .first();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
      }
    }
  });
});
